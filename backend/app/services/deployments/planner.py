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
from app.services.settings_service import get_setting


def _snapshot(session: SessionModel | None) -> dict | None:
    return (session.metadata_json or {}).get("host_snapshot") if session else None


def _runtime_mode(requested: str, snap: dict | None) -> str:
    if requested in ("docker", "uv_venv"):
        return requested
    if snap and snap.get("docker_present") and snap.get("nvidia_container_toolkit"):
        return "docker"
    return "uv_venv"


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

    blockers: list[str] = []
    if recommendation.requires_reprobe:
        blockers.append("No host snapshot is available. Refresh Machine Info before deploying.")
    if recommendation.force_required:
        blockers.extend(recommendation.warnings)
    if not model_ref:
        blockers.append("No Hugging Face repo is known for the selected model/quant.")

    steps: list[DeploymentPlanStep] = [
        DeploymentPlanStep(
            id="host_snapshot",
            title="Verify host snapshot",
            stage="preflight",
            command="nvidia-smi && docker --version || true && python3 --version || true",
            expected="GPU, driver, Docker, and Python facts are visible.",
            notes="This is the minimum data needed before trusting any generated launch command.",
        ),
        DeploymentPlanStep(
            id="disk_space",
            title="Check model cache disk space",
            stage="preflight",
            command="df -h ~/.cache/huggingface /tmp 2>/dev/null || df -h",
            expected="Free disk is larger than model size plus runtime image/cache overhead.",
        ),
    ]

    if mode == "docker":
        image = recommendation.install_plan.container_image if recommendation.install_plan else "vllm/vllm-openai:latest"
        steps.extend([
            DeploymentPlanStep(
                id="docker_gpu",
                title="Verify Docker GPU runtime",
                stage="preflight",
                command="docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi",
                expected="Container can see all GPUs.",
            ),
            DeploymentPlanStep(
                id="pull_image",
                title="Pull vLLM runtime image",
                stage="runtime",
                command=f"docker pull {image}",
                expected="Image exists locally before launch.",
            ),
        ])
    else:
        packages = " ".join(recommendation.install_plan.packages) if recommendation.install_plan else "vllm"
        steps.extend([
            DeploymentPlanStep(
                id="install_uv",
                title="Install uv if missing",
                stage="runtime",
                command="command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh",
                expected="uv is present on PATH.",
            ),
            DeploymentPlanStep(
                id="create_venv",
                title="Create vLLM virtual environment",
                stage="runtime",
                command=f"uv venv /opt/inferix/venvs/vllm && /opt/inferix/venvs/vllm/bin/uv pip install {packages}",
                expected="Pinned runtime packages import successfully.",
                notes="Package pins should come from stack_matrix before this becomes one-click.",
            ),
        ])

    if model_ref:
        token_prefix = "HUGGING_FACE_HUB_TOKEN=$HUGGING_FACE_HUB_TOKEN " if hf_token_configured else ""
        steps.append(
            DeploymentPlanStep(
                id="download_model",
                title="Download model artifacts",
                stage="model",
                command=f"{token_prefix}huggingface-cli download {model_ref} --local-dir-use-symlinks False",
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
                expected=f"Server listens on 127.0.0.1:{remote_port}.",
            )
        )

    steps.extend([
        DeploymentPlanStep(
            id="health_models",
            title="Check OpenAI-compatible model endpoint",
            stage="verify",
            command=f"curl -sf http://127.0.0.1:{remote_port}/v1/models",
            expected="Endpoint returns JSON model list.",
        ),
        DeploymentPlanStep(
            id="smoke_completion",
            title="Run a small completion smoke test",
            stage="verify",
            command=(
                f"curl -sf http://127.0.0.1:{remote_port}/v1/chat/completions "
                "-H 'Content-Type: application/json' "
                "-d '{\"model\":\"default\",\"messages\":[{\"role\":\"user\",\"content\":\"Say ok\"}],\"max_tokens\":8}'"
            ),
            expected="The model generates a short response.",
        ),
        DeploymentPlanStep(
            id="save_evidence",
            title="Capture deployment evidence",
            stage="evidence",
            command="nvidia-smi --query-gpu=name,memory.used,utilization.gpu --format=csv && docker ps --format '{{.Names}} {{.Status}}' || true",
            expected="Evidence can be stored on the run record and later published as a playbook/report.",
        ),
    ])

    return DeploymentPlanResponse(
        runtime_mode=mode,
        engine=engine,
        remote_port=remote_port,
        ready_to_run=not blockers,
        blockers=blockers,
        steps=steps,
        recommendation=recommendation,
    )
