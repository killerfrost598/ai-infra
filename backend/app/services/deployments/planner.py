"""Plan-first deployment framework.

This module deliberately returns an auditable plan instead of executing remote
commands. Execution will be layered on top as step events and cancellation.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.entities import Model, ModelQuant
from app.models.entities import Session as SessionModel
from app.schemas.deployment_plan import DeploymentPlanResponse, DeploymentPlanStep
from app.services.lab_recommender import recommend_launch
from app.services.settings_service import get_lab_preflight_command_overrides, get_setting


def _snapshot(session: SessionModel | None) -> dict | None:
    return (session.metadata_json or {}).get("host_snapshot") if session else None


def _runtime_mode(requested: str, snap: dict | None) -> str:
    if requested in ("docker", "uv_venv"):
        return requested
    if snap and snap.get("docker_present") and snap.get("nvidia_container_toolkit"):
        return "docker"
    return "uv_venv"


def _apt_command(command: str) -> str:
    return (
        "if command -v apt-get >/dev/null 2>&1; then "
        "if command -v sudo >/dev/null 2>&1; then "
        f"sudo -n {command} || {command}; "
        "else "
        f"{command}; "
        "fi; "
        "else echo 'apt-get not present; skipping'; fi"
    )


def _render_template(template: str, context: dict[str, str]) -> str:
    rendered = template
    for key, value in context.items():
        rendered = rendered.replace("{" + key + "}", value)
    return rendered


def _apply_command_overrides(
    steps: list[DeploymentPlanStep],
    *,
    db: Session,
    context: dict[str, str],
) -> list[DeploymentPlanStep]:
    overrides = get_lab_preflight_command_overrides(db)
    if not overrides:
        return steps

    next_steps: list[DeploymentPlanStep] = []
    for step in steps:
        patch = overrides.get(step.id)
        if not patch:
            next_steps.append(step)
            continue
        if patch.get("enabled") is False:
            continue

        values = step.model_dump()
        command = patch.get("command")
        if isinstance(command, str) and command:
            values["command"] = _render_template(command, context)
        for key in ("required", "auto_eligible", "recommended"):
            if key in patch:
                values[key] = bool(patch[key])
        notes = patch.get("notes")
        if isinstance(notes, str) and notes:
            values["notes"] = notes
        next_steps.append(DeploymentPlanStep.model_validate(values))
    return next_steps


def lab_preflight_command_templates() -> list[DeploymentPlanStep]:
    """Return configurable low-risk command templates for the Settings UI."""
    return [
        DeploymentPlanStep(
            id="host_snapshot",
            title="Verify host snapshot",
            stage="preflight",
            command="nvidia-smi && docker --version || true && python3 --version || true",
            auto_eligible=True,
            expected="GPU, driver, Docker, and Python facts are visible.",
            notes="Runs before deployment to capture basic host/runtime facts.",
        ),
        DeploymentPlanStep(
            id="disk_space",
            title="Check model cache disk space",
            stage="preflight",
            command="df -h ~/.cache/huggingface /tmp 2>/dev/null || df -h",
            auto_eligible=True,
            expected="Free disk is larger than model size plus runtime image/cache overhead.",
        ),
        DeploymentPlanStep(
            id="docker_gpu",
            title="Verify Docker GPU runtime",
            stage="preflight",
            command="docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi",
            auto_eligible=True,
            expected="Container can see all GPUs.",
        ),
        DeploymentPlanStep(
            id="apt_update",
            title="Refresh apt package metadata",
            stage="setup",
            command=_apt_command("apt-get update"),
            auto_eligible=True,
            recommended=True,
            expected="Package metadata is current when apt is available.",
            notes="Low-risk setup step; skipped on non-Debian hosts.",
        ),
        DeploymentPlanStep(
            id="ensure_curl",
            title="Ensure curl and certificates are installed",
            stage="setup",
            command=(
                "command -v curl >/dev/null 2>&1 || "
                f"({_apt_command('apt-get install -y curl ca-certificates')})"
            ),
            auto_eligible=True,
            recommended=True,
            expected="curl is present for uv and model tooling installers.",
        ),
        DeploymentPlanStep(
            id="install_uv",
            title="Install uv if missing",
            stage="setup",
            command="export PATH=\"$HOME/.local/bin:$PATH\"; command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh; command -v uv",
            auto_eligible=True,
            recommended=True,
            expected="uv is present on PATH.",
        ),
        DeploymentPlanStep(
            id="create_venv",
            title="Create vLLM virtual environment",
            stage="runtime",
            command=(
                "export PATH=\"$HOME/.local/bin:$PATH\" && "
                "mkdir -p ~/.inferix/venvs && "
                "([ -x ~/.inferix/venvs/vllm-{venv_id}/bin/python ] || uv venv ~/.inferix/venvs/vllm-{venv_id}) && "
                "uv pip install --python ~/.inferix/venvs/vllm-{venv_id}/bin/python {packages} huggingface_hub[cli]"
            ),
            auto_eligible=True,
            recommended=True,
            expected="Pinned runtime packages import successfully.",
            notes="Uses the uv executable on PATH; uv is not installed inside the created venv.",
        ),
    ]


def _template_by_id(step_id: str, context: dict[str, str]) -> DeploymentPlanStep:
    for template in lab_preflight_command_templates():
        if template.id == step_id:
            values = template.model_dump()
            if values.get("command"):
                values["command"] = _render_template(values["command"], context)
            return DeploymentPlanStep.model_validate(values)
    raise KeyError(step_id)


def build_deployment_plan(
    *,
    db: Session,
    server_id: UUID,
    model_id: UUID,
    quant_id: UUID,
    session_id: UUID | None,
    engine: str,
    remote_port: int,
    runtime_mode: str,
) -> DeploymentPlanResponse:
    recommendation = recommend_launch(
        server_id=server_id,
        model_id=model_id,
        quant_id=quant_id,
        engine_str=engine,
        db=db,
        session_id=session_id,
        remote_port=remote_port,
    )

    session = db.query(SessionModel).filter(SessionModel.id == session_id).first() if session_id else None
    snap = _snapshot(session)
    mode = _runtime_mode(runtime_mode, snap)
    model = db.query(Model).filter(Model.id == model_id).first()
    quant = db.query(ModelQuant).filter(ModelQuant.id == quant_id).first()

    model_ref = (quant.hf_repo if quant and quant.hf_repo else None) or (model.hf_repo if model else None) or ""
    hf_token_configured = bool(get_setting("hf_token", db))
    venv_id = str(recommendation.install_plan.stack_matrix_id if recommendation.install_plan else "default")
    packages = " ".join(recommendation.install_plan.packages) if recommendation.install_plan else "vllm"
    context = {
        "venv_id": venv_id,
        "packages": packages,
        "remote_port": str(remote_port),
    }

    blockers: list[str] = []
    if recommendation.requires_reprobe:
        blockers.append("No host snapshot is available. Refresh Machine Info before deploying.")
    if recommendation.force_required:
        blockers.extend(recommendation.warnings)
    if not model_ref:
        blockers.append("No Hugging Face repo is known for the selected model/quant.")
    if runtime_mode == "docker" and snap and not (snap.get("docker_present") and snap.get("nvidia_container_toolkit")):
        blockers.append("Docker runtime was requested, but Docker + NVIDIA Container Toolkit are not both ready.")

    steps: list[DeploymentPlanStep] = [
        _template_by_id("host_snapshot", context),
        _template_by_id("disk_space", context),
    ]

    if mode == "docker":
        image = recommendation.install_plan.container_image if recommendation.install_plan else "vllm/vllm-openai:latest"
        steps.extend([
            _template_by_id("docker_gpu", context),
            DeploymentPlanStep(
                id="pull_image",
                title="Pull vLLM runtime image",
                stage="runtime",
                command=f"docker pull {image}",
                auto_eligible=True,
                expected="Image exists locally before launch.",
            ),
        ])
    else:
        steps.extend([
            _template_by_id("apt_update", context),
            _template_by_id("ensure_curl", context),
            _template_by_id("install_uv", context),
            _template_by_id("create_venv", context),
        ])

    if model_ref:
        token_prefix = "HUGGING_FACE_HUB_TOKEN=$INFERIX_HF_TOKEN " if hf_token_configured else ""
        if mode == "docker":
            image = recommendation.install_plan.container_image if recommendation.install_plan else "vllm/vllm-openai:latest"
            token_env = "-e HUGGING_FACE_HUB_TOKEN=$INFERIX_HF_TOKEN " if hf_token_configured else ""
            download_command = (
                f"docker run --rm --entrypoint huggingface-cli "
                f"-v ~/.cache/huggingface:/root/.cache/huggingface "
                f"{token_env}{image} download {model_ref} --local-dir-use-symlinks False"
            )
        else:
            download_command = (
                f"{token_prefix}~/.inferix/venvs/vllm-{venv_id}/bin/huggingface-cli "
                f"download {model_ref} --local-dir-use-symlinks False"
            )
        steps.append(
            DeploymentPlanStep(
                id="download_model",
                title="Download model artifacts",
                stage="model",
                command=download_command,
                auto_eligible=True,
                recommended=True,
                expected="Model files are cached before vLLM starts.",
                notes="The executor should stream this step so the operator sees download progress.",
            )
        )

    if recommendation.injectable_command:
        steps.append(
            DeploymentPlanStep(
                id="launch_vllm",
                title="Launch vLLM OpenAI-compatible server",
                stage="launch",
                command=recommendation.injectable_command,
                auto_eligible=True,
                expected=f"Server listens on 127.0.0.1:{remote_port}.",
            )
        )

    steps.extend([
        DeploymentPlanStep(
            id="health_models",
            title="Check OpenAI-compatible model endpoint",
            stage="verify",
            command=f"curl -sf http://127.0.0.1:{remote_port}/v1/models",
            auto_eligible=True,
            expected="Endpoint returns JSON model list.",
        ),
        DeploymentPlanStep(
            id="smoke_completion",
            title="Run a small completion smoke test",
            stage="verify",
            command=(
                f"curl -sf http://127.0.0.1:{remote_port}/v1/chat/completions "
                "-H 'Content-Type: application/json' "
                f"-d '{{\"model\":\"{model_ref or 'default'}\",\"messages\":[{{\"role\":\"user\",\"content\":\"Say ok\"}}],\"max_tokens\":8}}'"
            ),
            auto_eligible=True,
            expected="The model generates a short response.",
        ),
        DeploymentPlanStep(
            id="save_evidence",
            title="Capture deployment evidence",
            stage="evidence",
            command="nvidia-smi --query-gpu=name,memory.used,utilization.gpu --format=csv && docker ps --format '{{.Names}} {{.Status}}' || true",
            auto_eligible=True,
            expected="Evidence can be stored on the run record and later published as a playbook/report.",
        ),
    ])

    steps = _apply_command_overrides(steps, db=db, context=context)

    return DeploymentPlanResponse(
        runtime_mode=mode,
        engine=engine,
        remote_port=remote_port,
        ready_to_run=not blockers,
        blockers=blockers,
        steps=steps,
        recommendation=recommendation,
    )
