"""Lab API — recommendation, PTY inject, and live observation endpoints."""

import asyncio
import logging
import time
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import EngineKind, FailureStage, Model, ModelQuant, ModelRunAttempt, RunStatus, Server, TaskRun, TaskStatus
from app.models.entities import Session as SessionModel, SessionStatus
from app.schemas.lab import (
    AiAssistRequest,
    AiAssistResponse,
    ExecuteRecommendationRequest,
    ExecuteRecommendationResponse,
    InjectRequest,
    InjectResponse,
    LaunchRecommendation,
    ObserveRequest,
    ObserveResponse,
    RecommendRequest,
)
from app.schemas.agent_runs import (
    AgentRunEvent,
    AgentRunRequest,
    AgentRunStartResponse,
    AgentRunStatusResponse,
    AgentToolApprovalRequest,
    AgentToolApprovalResponse,
    PromotePlaybookResponse,
)
from app.schemas.deployment_plan import (
    DeploymentPlanRequest,
    DeploymentPlanResponse,
    DeploymentPlanStep,
    DeploymentRunRequest,
    DeploymentRunStartResponse,
    DeploymentRunStatusResponse,
    PipelineDownloadModelRequest,
    PipelineModelFlags,
    PipelineRunModelRequest,
    PipelineStartResponse,
    PipelineStepRequest,
)
from app.schemas.model_runs import ModelRunAttemptResponse
from app.services.ai_deploy_assistant import build_deploy_context, choose_provider, generate_deploy_guidance
from app.services.agent_run import (
    _initial_agent_steps,
    agent_status_response,
    approve_agent_tool,
    promote_agent_playbook,
    request_cancel_agent_run,
    run_agent_task,
    model_tmux_session_name,
)
from app.services.deployments.executor import run_deployment_task, run_pipeline_step_task
from app.services.deployments.planner import build_deployment_plan, lab_preflight_command_templates
from app.services import session_store
from app.services.lab_recommender import recommend_launch
from app.services.session_runner import execute_command
from app.services.settings_service import get_lab_auto_setup_mode, get_setting

logger = logging.getLogger(__name__)

router = APIRouter()


def _run_to_response(run: ModelRunAttempt) -> ModelRunAttemptResponse:
    return ModelRunAttemptResponse(
        id=run.id,
        server_id=run.server_id,
        session_id=run.session_id,
        model_id=run.model_id,
        quant_id=run.quant_id,
        host_snapshot_id=run.host_snapshot_id,
        task_run_id=run.task_run_id,
        engine=run.engine.value if isinstance(run.engine, EngineKind) else run.engine,
        engine_version=run.engine_version,
        mode=run.mode,
        container_image=run.container_image,
        container_id=run.container_id,
        launch_command=run.launch_command,
        launch_plan_json=run.launch_plan_json,
        feasibility_verdict=run.feasibility_verdict,
        forced=run.forced,
        status=run.status.value if isinstance(run.status, RunStatus) else run.status,
        succeeded=run.succeeded,
        failure_stage=run.failure_stage.value if isinstance(run.failure_stage, FailureStage) else run.failure_stage,
        failure_message=run.failure_message,
        ttft_ms=run.ttft_ms,
        tps_steady=run.tps_steady,
        vram_used_gb=run.vram_used_gb,
        health_check_url=run.health_check_url,
        health_check_ok=run.health_check_ok,
        operator_notes=run.operator_notes,
        started_at=run.started_at,
        completed_at=run.completed_at,
        duration_seconds=run.duration_seconds,
        published_url=run.published_url,
        published_sha=run.published_sha,
        published_at=run.published_at,
        updated_at=run.updated_at,
        created_at=run.created_at,
    )


def _ssh_exec(handle, command: str, timeout: int) -> tuple[str, str, int]:
    """Run a command on a separate SSH exec channel so the PTY websocket does not race it."""
    stdin, stdout, stderr = handle.client.exec_command(command, timeout=timeout)
    stdin.close()
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    return out, err, exit_code


def _poll_health(handle, remote_port: int, timeout_seconds: int) -> bool:
    deadline = time.monotonic() + max(1, timeout_seconds)
    cmd = f"curl -sf --max-time 5 http://127.0.0.1:{remote_port}/v1/models >/dev/null 2>&1"
    while time.monotonic() < deadline:
        try:
            _, _, rc = _ssh_exec(handle, cmd, timeout=10)
            if rc == 0:
                return True
        except Exception:
            pass
        time.sleep(5)
    return False


def _read_vram_used(handle) -> float | None:
    try:
        stdout, _, rc = _ssh_exec(
            handle,
            "nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits",
            timeout=10,
        )
    except Exception:
        return None
    if rc != 0 or not stdout.strip():
        return None
    total_mb = 0
    for line in stdout.strip().splitlines():
        try:
            total_mb += int(line.strip())
        except ValueError:
            pass
    return round(total_mb / 1024, 2) if total_mb else None


def _extract_container_id(stdout: str) -> str | None:
    for line in stdout.splitlines():
        candidate = line.strip()
        if len(candidate) >= 12 and all(ch in "0123456789abcdef" for ch in candidate.lower()):
            return candidate[:64]
    return None


def _expand_runtime_secrets(command: str, db: Session) -> str:
    hf_token = get_setting("hf_token", db) or ""
    return command.replace("$INFERIX_HF_TOKEN", hf_token)


@router.post("/recommend", response_model=LaunchRecommendation)
def recommend(payload: RecommendRequest, db: Session = Depends(get_db)) -> LaunchRecommendation:
    """Return a feasibility-checked launch plan for a server + model + quant combination.

    The host snapshot is read from session.metadata_json["host_snapshot"].
    Returns requires_reprobe=True when no snapshot is available — the UI
    should prompt the operator to run POST /sessions/{id}/refresh-snapshot first.
    """
    return recommend_launch(
        server_id=payload.server_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        engine_str=payload.engine,
        db=db,
        session_id=payload.session_id,
        remote_port=payload.remote_port,
    )


@router.post("/assist", response_model=AiAssistResponse)
def assist(payload: AiAssistRequest, db: Session = Depends(get_db)) -> AiAssistResponse:
    """Ask the configured AI provider for operator-reviewed deployment guidance."""
    recommendation = recommend_launch(
        server_id=payload.server_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        engine_str=payload.engine,
        db=db,
        session_id=payload.session_id,
        remote_port=payload.remote_port,
    )
    context = build_deploy_context(
        db=db,
        server_id=payload.server_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        session_id=payload.session_id,
        recommendation=recommendation,
        operator_goal=payload.operator_goal,
    )
    try:
        provider, api_key, model_name = choose_provider(payload.provider, db)
        guidance = generate_deploy_guidance(
            provider=provider,
            api_key=api_key,
            model=model_name,
            context=context,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("AI deployment assistance failed")
        raise HTTPException(status_code=502, detail=f"AI provider error: {exc}") from exc

    return AiAssistResponse(
        provider=provider,
        model=model_name,
        guidance=guidance,
        prompt_context=context if payload.include_prompt_context else None,
    )


@router.post("/deployments/plan", response_model=DeploymentPlanResponse)
def plan_deployment(payload: DeploymentPlanRequest, db: Session = Depends(get_db)) -> DeploymentPlanResponse:
    """Return a robust deployment plan with explicit preflight/setup/download/verify steps."""
    return build_deployment_plan(
        db=db,
        server_id=payload.server_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        session_id=payload.session_id,
        engine=payload.engine,
        remote_port=payload.remote_port,
        runtime_mode=payload.runtime_mode,
    )


@router.get("/preflight-command-templates", response_model=list[DeploymentPlanStep])
def preflight_command_templates() -> list[DeploymentPlanStep]:
    """Return the configurable low-risk Lab command templates."""
    return lab_preflight_command_templates()


@router.post("/deployments/run", response_model=DeploymentRunStartResponse, status_code=202)
def run_deployment(
    payload: DeploymentRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> DeploymentRunStartResponse:
    """Start a structured Lab deployment workflow and stream progress via TaskRun logs."""
    session = db.query(SessionModel).filter(SessionModel.id == payload.session_id).first() if payload.session_id else None
    if not session:
        raise HTTPException(status_code=404, detail="Active session is required to run a Lab deployment")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is terminated")
    if session.server_id != payload.server_id:
        raise HTTPException(status_code=422, detail="Payload server_id does not match session server_id")
    if session_store.get(str(session.id)) is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")

    auto_setup_mode = payload.auto_setup_mode or get_lab_auto_setup_mode(db)
    if auto_setup_mode not in {"recommend_only", "auto_low_risk_setup"}:
        auto_setup_mode = "recommend_only"

    plan = build_deployment_plan(
        db=db,
        server_id=payload.server_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        session_id=payload.session_id,
        engine=payload.engine,
        remote_port=payload.remote_port,
        runtime_mode=payload.runtime_mode,
    )

    try:
        engine = EngineKind(payload.engine.upper())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Unknown engine '{payload.engine}'") from exc

    install_plan = plan.recommendation.install_plan
    run = ModelRunAttempt(
        server_id=payload.server_id,
        session_id=payload.session_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        engine=engine,
        mode="container" if plan.runtime_mode == "docker" else "venv",
        container_image=install_plan.container_image if install_plan else None,
        launch_command=plan.recommendation.injectable_command,
        launch_plan_json=jsonable_encoder(plan),
        feasibility_verdict=plan.recommendation.feasibility.verdict if plan.recommendation.feasibility else "UNKNOWN",
        forced=payload.force,
        status=RunStatus.PLANNED,
    )
    db.add(run)
    db.flush()

    task_run = TaskRun(
        task_type="lab.deployment",
        status=TaskStatus.PENDING,
        server_id=payload.server_id,
        started_at=datetime.now(timezone.utc),
        metadata_json={
            "deployment_run": True,
            "model_run_id": str(run.id),
            "session_id": str(session.id),
            "runtime_mode": plan.runtime_mode,
            "runtime_mode_requested": payload.runtime_mode,
            "auto_setup_mode": auto_setup_mode,
            "cancel_requested": False,
            "steps": [jsonable_encoder(step) for step in plan.steps],
        },
    )
    db.add(task_run)
    db.flush()
    run.task_run_id = task_run.id
    db.commit()

    background_tasks.add_task(
        run_deployment_task,
        task_run_id=str(task_run.id),
        model_run_id=str(run.id),
        session_id=str(session.id),
        auto_setup_mode=auto_setup_mode,
        health_timeout_seconds=payload.health_timeout_seconds,
        command_timeout_seconds=payload.command_timeout_seconds,
    )

    return DeploymentRunStartResponse(
        task_run_id=task_run.id,
        model_run_id=run.id,
        status=task_run.status.value if hasattr(task_run.status, "value") else str(task_run.status),
    )


@router.get("/deployments/runs/{task_run_id}", response_model=DeploymentRunStatusResponse)
def get_deployment_run(task_run_id: UUID, db: Session = Depends(get_db)) -> DeploymentRunStatusResponse:
    task_run = db.query(TaskRun).filter(TaskRun.id == task_run_id).first()
    if not task_run:
        raise HTTPException(status_code=404, detail="Task run not found")
    metadata = task_run.metadata_json or {}
    return DeploymentRunStatusResponse(
        task_run_id=task_run.id,
        model_run_id=UUID(metadata["model_run_id"]) if metadata.get("model_run_id") else None,
        status=task_run.status.value if hasattr(task_run.status, "value") else str(task_run.status),
        error_summary=task_run.error_summary,
        runtime_mode=metadata.get("runtime_mode"),
        auto_setup_mode=metadata.get("auto_setup_mode"),
        cancel_requested=bool(metadata.get("cancel_requested")),
        steps=metadata.get("steps") or [],
    )


@router.post("/deployments/runs/{task_run_id}/cancel", response_model=DeploymentRunStatusResponse)
def cancel_deployment_run(task_run_id: UUID, db: Session = Depends(get_db)) -> DeploymentRunStatusResponse:
    task_run = db.query(TaskRun).filter(TaskRun.id == task_run_id).first()
    if not task_run:
        raise HTTPException(status_code=404, detail="Task run not found")
    metadata = dict(task_run.metadata_json or {})
    metadata["cancel_requested"] = True
    task_run.metadata_json = metadata
    db.commit()
    return get_deployment_run(task_run_id, db)


def _get_agent_task(task_run_id: UUID, db: Session) -> TaskRun:
    task_run = db.query(TaskRun).filter(TaskRun.id == task_run_id).first()
    if not task_run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if task_run.task_type != "lab.agent_run":
        raise HTTPException(status_code=404, detail="Agent run not found")
    return task_run


@router.post("/agent-runs", response_model=AgentRunStartResponse, status_code=202)
def start_agent_run(
    payload: AgentRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> AgentRunStartResponse:
    """Start a guarded AI-style Lab run that owns one managed tmux session."""
    session = db.query(SessionModel).filter(SessionModel.id == payload.session_id).first() if payload.session_id else None
    if not session:
        raise HTTPException(status_code=404, detail="Active session is required to run the Lab agent")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is terminated")
    if session.server_id != payload.server_id:
        raise HTTPException(status_code=422, detail="Payload server_id does not match session server_id")
    if session_store.get(str(session.id)) is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")

    try:
        engine = EngineKind(payload.engine.upper())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Unknown engine '{payload.engine}'") from exc
    if not db.query(Server).filter(Server.id == payload.server_id).first():
        raise HTTPException(status_code=404, detail="Server not found")
    if not db.query(Model).filter(Model.id == payload.model_id).first():
        raise HTTPException(status_code=404, detail="Model not found")
    if not db.query(ModelQuant).filter(ModelQuant.id == payload.quant_id).first():
        raise HTTPException(status_code=404, detail="ModelQuant not found")

    recommendation = recommend_launch(
        server_id=payload.server_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        engine_str=payload.engine,
        db=db,
        session_id=payload.session_id,
        remote_port=payload.remote_port,
    )

    run = ModelRunAttempt(
        server_id=payload.server_id,
        session_id=payload.session_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        engine=engine,
        mode=recommendation.install_plan.mode if recommendation.install_plan else "container",
        container_image=recommendation.install_plan.container_image if recommendation.install_plan else None,
        launch_command=recommendation.injectable_command,
        launch_plan_json=recommendation.model_dump(mode="json"),
        feasibility_verdict=recommendation.feasibility.verdict if recommendation.feasibility else "UNKNOWN",
        forced=payload.force,
        status=RunStatus.PLANNED,
    )
    db.add(run)
    db.flush()

    tmux_session = model_tmux_session_name(run.id)
    task_run = TaskRun(
        task_type="lab.agent_run",
        status=TaskStatus.PENDING,
        server_id=payload.server_id,
        started_at=datetime.now(timezone.utc),
        metadata_json={
            "agent_run": True,
            "model_run_id": str(run.id),
            "session_id": str(session.id),
            "request": payload.model_dump(mode="json"),
            "cancel_requested": False,
            "agent": {
                "model_run_id": str(run.id),
                "session_id": str(session.id),
                "tmux_session": tmux_session,
                "events": [],
                "steps": _initial_agent_steps(),
                "health": {},
                "success_ready": False,
                "cancel_requested": False,
            },
        },
    )
    db.add(task_run)
    db.flush()
    run.task_run_id = task_run.id
    db.commit()

    background_tasks.add_task(
        run_agent_task,
        task_run_id=str(task_run.id),
        model_run_id=str(run.id),
        session_id=str(session.id),
        max_iterations=max(1, min(payload.max_iterations, 5)),
        command_timeout_seconds=max(30, payload.command_timeout_seconds),
        health_timeout_seconds=max(30, payload.health_timeout_seconds),
    )

    return AgentRunStartResponse(
        task_run_id=task_run.id,
        model_run_id=run.id,
        status=task_run.status.value if hasattr(task_run.status, "value") else str(task_run.status),
        tmux_session=tmux_session,
    )


@router.get("/agent-runs/{task_run_id}", response_model=AgentRunStatusResponse)
def get_agent_run(task_run_id: UUID, db: Session = Depends(get_db)) -> AgentRunStatusResponse:
    return agent_status_response(_get_agent_task(task_run_id, db))


@router.get("/agent-runs/{task_run_id}/events", response_model=list[AgentRunEvent])
def get_agent_run_events(task_run_id: UUID, db: Session = Depends(get_db)) -> list[AgentRunEvent]:
    return agent_status_response(_get_agent_task(task_run_id, db)).events


@router.post("/agent-runs/{task_run_id}/cancel", response_model=AgentRunStatusResponse)
def cancel_agent_run(task_run_id: UUID, db: Session = Depends(get_db)) -> AgentRunStatusResponse:
    return request_cancel_agent_run(_get_agent_task(task_run_id, db), db)


@router.post("/agent-runs/{task_run_id}/approve-tool", response_model=AgentToolApprovalResponse)
def approve_agent_run_tool(
    task_run_id: UUID,
    payload: AgentToolApprovalRequest,
    db: Session = Depends(get_db),
) -> AgentToolApprovalResponse:
    task_run = _get_agent_task(task_run_id, db)
    approve_agent_tool(task_run, db, payload.tool_call_id, payload.approved, payload.note)
    return AgentToolApprovalResponse(task_run_id=task_run.id, tool_call_id=payload.tool_call_id, approved=payload.approved)


@router.post("/agent-runs/{task_run_id}/promote-playbook", response_model=PromotePlaybookResponse)
def promote_agent_run_playbook(task_run_id: UUID, db: Session = Depends(get_db)) -> PromotePlaybookResponse:
    task_run = _get_agent_task(task_run_id, db)
    try:
        return promote_agent_playbook(task_run, db)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/execute-recommendation", response_model=ExecuteRecommendationResponse)
def execute_recommendation(
    session_id: UUID,
    payload: ExecuteRecommendationRequest,
    db: Session = Depends(get_db),
) -> ExecuteRecommendationResponse:
    """Plan, execute, health-check, and record a model launch over SSH.

    This is the operator-assisted closed loop for Lab. It does not use the PTY
    channel, so it can run while the terminal websocket is mounted.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is terminated")
    if session.server_id != payload.server_id:
        raise HTTPException(status_code=422, detail="Payload server_id does not match session server_id")

    handle = session_store.get(str(session_id))
    if handle is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")

    recommendation = recommend_launch(
        server_id=payload.server_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        engine_str=payload.engine,
        db=db,
        session_id=session_id,
        remote_port=payload.remote_port,
    )

    if recommendation.requires_reprobe:
        raise HTTPException(status_code=409, detail="No host snapshot available; refresh Machine Info first")
    if not recommendation.injectable_command:
        detail = "; ".join(recommendation.warnings) or "No launch command could be generated"
        raise HTTPException(status_code=422, detail=detail)
    if recommendation.force_required and not payload.force:
        raise HTTPException(status_code=422, detail="Recommendation is blocked; pass force=true to override")

    try:
        engine = EngineKind(payload.engine.upper())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Unknown engine '{payload.engine}'") from exc

    plan_json = recommendation.install_plan.model_dump() if recommendation.install_plan else None
    run = ModelRunAttempt(
        server_id=payload.server_id,
        session_id=session_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        engine=engine,
        mode=recommendation.install_plan.mode if recommendation.install_plan else "container",
        container_image=recommendation.install_plan.container_image if recommendation.install_plan else None,
        launch_command=recommendation.injectable_command,
        launch_plan_json=plan_json,
        feasibility_verdict=recommendation.feasibility.verdict if recommendation.feasibility else "UNKNOWN",
        forced=payload.force,
        status=RunStatus.RUNNING,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    command_stdout = ""
    command_stderr = ""
    command_exit_code: int | None = None
    health_ok: bool | None = None
    vram_used_gb: float | None = None

    try:
        command_stdout, command_stderr, command_exit_code = _ssh_exec(
            handle,
            _expand_runtime_secrets(recommendation.injectable_command, db),
            timeout=max(30, payload.command_timeout_seconds),
        )
        run.container_id = _extract_container_id(command_stdout)

        if command_exit_code != 0:
            run.status = RunStatus.FAILED
            run.succeeded = False
            run.failure_stage = FailureStage.OTHER
            run.failure_message = (command_stderr or command_stdout or "Launch command failed")[:4000]
        else:
            health_ok = _poll_health(handle, payload.remote_port, payload.health_timeout_seconds)
            vram_used_gb = _read_vram_used(handle)
            run.health_check_url = f"http://127.0.0.1:{payload.remote_port}/v1/models"
            run.health_check_ok = health_ok
            run.vram_used_gb = vram_used_gb
            if health_ok:
                run.status = RunStatus.SUCCESS
                run.succeeded = True
            else:
                run.status = RunStatus.FAILED
                run.succeeded = False
                run.failure_stage = FailureStage.HEALTH_CHECK
                run.failure_message = f"Health check did not pass within {payload.health_timeout_seconds}s"
    except Exception as exc:
        logger.exception("Lab execute recommendation failed")
        run.status = RunStatus.FAILED
        run.succeeded = False
        run.failure_stage = FailureStage.OTHER
        run.failure_message = str(exc)[:4000]
    finally:
        now = datetime.now(timezone.utc)
        run.completed_at = now
        if run.started_at:
            run.duration_seconds = max(0, int((now - run.started_at).total_seconds()))
        db.commit()
        db.refresh(run)

    return ExecuteRecommendationResponse(
        run=_run_to_response(run),
        recommendation=recommendation,
        command_exit_code=command_exit_code,
        command_stdout=command_stdout,
        command_stderr=command_stderr,
        health_ok=health_ok,
        vram_used_gb=vram_used_gb,
    )


@router.post("/sessions/{session_id}/inject", response_model=InjectResponse)
def inject_command(
    session_id: UUID,
    payload: InjectRequest,
    db: Session = Depends(get_db),
) -> InjectResponse:
    """Write a command into the live PTY channel so the operator can review and run it.

    With dry_run=True the command is returned without being written to the PTY.
    When model_run_id is provided the run is transitioned to RUNNING status.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is terminated")

    handle = session_store.get(str(session_id))
    if handle is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")

    if payload.dry_run:
        return InjectResponse(injected=False, command=payload.command)

    try:
        handle.channel.sendall((payload.command + "\n").encode())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"PTY write failed: {exc}") from exc

    # Transition the linked run attempt to RUNNING
    if payload.model_run_id:
        run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == payload.model_run_id).first()
        if run and run.status == RunStatus.PLANNED:
            run.status = RunStatus.RUNNING
            run.launch_command = payload.command
            db.commit()

    return InjectResponse(injected=True, command=payload.command)


@router.post("/sessions/{session_id}/observe", response_model=ObserveResponse)
def observe_session(
    session_id: UUID,
    payload: ObserveRequest,
    db: Session = Depends(get_db),
) -> ObserveResponse:
    """Run live VRAM and health probes over the PTY and auto-fill run metrics.

    Executes nvidia-smi (VRAM / GPU utilization) and an HTTP health check
    against the provided URL, then patches the linked ModelRunAttempt if given.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is terminated")

    handle = session_store.get(str(session_id))
    if handle is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")

    raw: dict = {}
    vram_used_gb: float | None = None
    gpu_util_pct: float | None = None
    health_ok: bool | None = None

    # -- VRAM + GPU utilization ------------------------------------------------
    try:
        stdout, _, rc = execute_command(
            handle.channel,
            "nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits",
            timeout=10.0,
        )
        raw["nvidia_smi"] = stdout
        if rc == 0 and stdout.strip():
            # Aggregate across all GPUs
            total_vram_mb = 0
            utils: list[float] = []
            for line in stdout.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 2:
                    try:
                        total_vram_mb += int(parts[0])
                        utils.append(float(parts[1]))
                    except ValueError:
                        pass
            if total_vram_mb:
                vram_used_gb = round(total_vram_mb / 1024, 2)
            if utils:
                gpu_util_pct = round(sum(utils) / len(utils), 1)
    except Exception as exc:
        logger.debug("nvidia-smi observe failed: %s", exc)

    # -- Health check via curl -------------------------------------------------
    health_url = payload.health_check_url
    if health_url:
        try:
            stdout, _, rc = execute_command(
                handle.channel,
                f"curl -sf --max-time 5 {health_url} >/dev/null 2>&1 && echo ok || echo fail",
                timeout=12.0,
            )
            raw["health_check"] = stdout.strip()
            health_ok = stdout.strip() == "ok"
        except Exception as exc:
            logger.debug("health check observe failed: %s", exc)
            health_ok = False

    # -- Patch the linked run attempt -----------------------------------------
    if payload.model_run_id and (vram_used_gb is not None or health_ok is not None):
        run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == payload.model_run_id).first()
        if run:
            if vram_used_gb is not None:
                run.vram_used_gb = vram_used_gb
            if health_ok is not None:
                run.health_check_ok = health_ok
                run.health_check_url = health_url
            if health_ok and run.status == RunStatus.RUNNING:
                run.status = RunStatus.SUCCESS
                run.succeeded = True
            db.commit()

    return ObserveResponse(
        vram_used_gb=vram_used_gb,
        gpu_utilization_pct=gpu_util_pct,
        health_ok=health_ok,
        raw=raw,
    )


# ── Pipeline endpoints (4-step Lab deploy flow) ───────────────────────────────

def _require_pipeline_session(session_id, server_id, db: Session) -> "SessionModel":
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is terminated")
    if session.server_id != server_id:
        raise HTTPException(status_code=422, detail="Server ID does not match session")
    if session_store.get(str(session.id)) is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")
    return session


def _build_vllm_serve_cmd(hf_repo: str, flags: PipelineModelFlags) -> str:
    venv = "~/.inferix/venvs/vllm-2"
    parts = [
        f"{venv}/bin/vllm serve {hf_repo}",
        f"--port {flags.remote_port}",
        f"--gpu-memory-utilization {flags.gpu_memory_utilization}",
        f"--dtype {flags.dtype}",
    ]
    if flags.tensor_parallel_size > 1:
        parts.append(f"--tensor-parallel-size {flags.tensor_parallel_size}")
    if flags.max_model_len:
        parts.append(f"--max-model-len {flags.max_model_len}")
    if flags.enable_tools:
        parts.append("--enable-auto-tool-choice")
        if flags.tool_call_parser:
            parts.append(f"--tool-call-parser {flags.tool_call_parser}")
    if flags.enable_thinking and flags.reasoning_parser:
        parts.append(f"--reasoning-parser {flags.reasoning_parser}")
    if flags.enable_chunked_prefill:
        parts.append("--enable-chunked-prefill")
    if flags.trust_remote_code:
        parts.append("--trust-remote-code")
    if flags.extra_flags.strip():
        parts.append(flags.extra_flags.strip())
    return " ".join(parts)


def _make_pipeline_task(task_type: str, server_id, session_id, meta: dict, db: Session) -> TaskRun:
    task_run = TaskRun(
        task_type=task_type,
        status=TaskStatus.PENDING,
        server_id=server_id,
        started_at=datetime.now(timezone.utc),
        metadata_json={"session_id": str(session_id), **meta},
    )
    db.add(task_run)
    db.commit()
    return task_run


@router.post("/pipeline/init-server", response_model=PipelineStartResponse, status_code=202)
def pipeline_init_server(
    payload: PipelineStepRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> PipelineStartResponse:
    """Step 1: Install curl, uv, create Python 3.12 venv at ~/.inferix/venvs/vllm-2."""
    _require_pipeline_session(payload.session_id, payload.server_id, db)
    commands = [
        (
            "if ! command -v curl >/dev/null 2>&1; then\n"
            "  echo '[+] Installing curl...'\n"
            "  apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates\n"
            "else\n"
            "  echo \"[+] curl already installed: $(curl --version | head -n1)\"\n"
            "fi"
        ),
        (
            "export PATH=\"$HOME/.local/bin:$PATH\"\n"
            "if ! command -v uv >/dev/null 2>&1; then\n"
            "  echo '[+] Installing uv...'\n"
            "  curl -LsSf https://astral.sh/uv/install.sh | sh\n"
            "  source \"$HOME/.local/bin/env\" 2>/dev/null || true\n"
            "else\n"
            "  echo \"[+] uv already installed: $(uv --version)\"\n"
            "fi\n"
            "grep -q 'HOME/.local/bin' ~/.bashrc 2>/dev/null || "
            "echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> ~/.bashrc"
        ),
        (
            "export PATH=\"$HOME/.local/bin:$PATH\"\n"
            "VENV=\"$HOME/.inferix/venvs/vllm-2\"\n"
            "mkdir -p \"$(dirname \"$VENV\")\"\n"
            "if [ ! -x \"$VENV/bin/python\" ]; then\n"
            "  echo \"[+] Creating venv at $VENV...\"\n"
            "  uv venv \"$VENV\" --python 3.12\n"
            "  echo '[+] Venv created'\n"
            "else\n"
            "  echo \"[+] Venv already exists at $VENV\"\n"
            "fi"
        ),
    ]
    task_run = _make_pipeline_task(
        "lab.pipeline.init_server", payload.server_id, payload.session_id,
        {"pipeline_step": "init_server"}, db,
    )
    background_tasks.add_task(
        run_pipeline_step_task,
        task_run_id=str(task_run.id),
        session_id=str(payload.session_id),
        commands=commands,
        step_name="init server",
    )
    return PipelineStartResponse(task_run_id=task_run.id, status="PENDING")


@router.post("/pipeline/install-vllm", response_model=PipelineStartResponse, status_code=202)
def pipeline_install_vllm(
    payload: PipelineStepRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> PipelineStartResponse:
    """Step 2: Probe CUDA version and install the matching vLLM into the managed venv."""
    _require_pipeline_session(payload.session_id, payload.server_id, db)
    commands = [
        (
            "export PATH=\"$HOME/.local/bin:$PATH\"\n"
            "VENV=\"$HOME/.inferix/venvs/vllm-2\"\n"
            "echo '[+] Probing CUDA version...'\n"
            "CUDA_VER=$(nvidia-smi 2>/dev/null | grep -oP 'CUDA Version: \\K[\\d.]+' || echo 'unknown')\n"
            "echo \"[+] Detected CUDA: $CUDA_VER\"\n"
            "CUDA_MAJOR=$(echo \"$CUDA_VER\" | cut -d. -f1 2>/dev/null || echo '0')\n"
            "CUDA_MINOR=$(echo \"$CUDA_VER\" | cut -d. -f2 2>/dev/null || echo '0')\n"
            "if [ \"$CUDA_MAJOR\" = '11' ]; then\n"
            "  VLLM_PKG='vllm==0.4.3'\n"
            "elif [ \"$CUDA_MAJOR\" = '12' ] && [ \"$CUDA_MINOR\" = '1' ]; then\n"
            "  VLLM_PKG='vllm==0.6.6'\n"
            "else\n"
            "  VLLM_PKG='vllm'\n"
            "fi\n"
            "echo \"[+] Installing: $VLLM_PKG\"\n"
            "$VENV/bin/uv pip install \"$VLLM_PKG\"\n"
            "echo '[+] Verifying installation...'\n"
            "$VENV/bin/python -c \"import vllm; print(f'[+] vLLM {vllm.__version__} installed')\""
        ),
    ]
    task_run = _make_pipeline_task(
        "lab.pipeline.install_vllm", payload.server_id, payload.session_id,
        {"pipeline_step": "install_vllm"}, db,
    )
    background_tasks.add_task(
        run_pipeline_step_task,
        task_run_id=str(task_run.id),
        session_id=str(payload.session_id),
        commands=commands,
        step_name="install vLLM",
    )
    return PipelineStartResponse(task_run_id=task_run.id, status="PENDING")


@router.post("/pipeline/download-model", response_model=PipelineStartResponse, status_code=202)
def pipeline_download_model(
    payload: PipelineDownloadModelRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> PipelineStartResponse:
    """Step 3: Download model weights to ~/.cache/huggingface on the remote server."""
    _require_pipeline_session(payload.session_id, payload.server_id, db)
    from app.models.entities import Model as ModelEntity, ModelQuant as ModelQuantEntity
    model = db.query(ModelEntity).filter(ModelEntity.id == payload.model_id).first()
    quant = db.query(ModelQuantEntity).filter(ModelQuantEntity.id == payload.quant_id).first()
    if not model or not quant:
        raise HTTPException(status_code=404, detail="Model or quant not found")
    hf_repo = quant.hf_repo or model.hf_repo or model.model_key
    commands = [
        (
            "export PATH=\"$HOME/.local/bin:$PATH\"\n"
            f"VENV=\"$HOME/.inferix/venvs/vllm-2\"\n"
            f"REPO=\"{hf_repo}\"\n"
            f"HF_CACHE=\"$HOME/.cache/huggingface\"\n"
            f"echo \"[+] Downloading $REPO...\"\n"
            f"HF_TOKEN=$INFERIX_HF_TOKEN $VENV/bin/huggingface-cli download \"$REPO\" --cache-dir \"$HF_CACHE\"\n"
            f"echo \"[+] Download complete: $REPO\""
        ),
    ]
    task_run = _make_pipeline_task(
        "lab.pipeline.download_model", payload.server_id, payload.session_id,
        {"pipeline_step": "download_model", "hf_repo": hf_repo,
         "model_id": str(payload.model_id), "quant_id": str(payload.quant_id)}, db,
    )
    background_tasks.add_task(
        run_pipeline_step_task,
        task_run_id=str(task_run.id),
        session_id=str(payload.session_id),
        commands=commands,
        step_name=f"download {hf_repo}",
    )
    return PipelineStartResponse(task_run_id=task_run.id, status="PENDING")


@router.post("/pipeline/run-model", response_model=PipelineStartResponse, status_code=202)
def pipeline_run_model(
    payload: PipelineRunModelRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> PipelineStartResponse:
    """Step 4: Launch vLLM in tmux session inferix-vllm with specified capability flags."""
    _require_pipeline_session(payload.session_id, payload.server_id, db)
    from app.models.entities import Model as ModelEntity, ModelQuant as ModelQuantEntity
    model = db.query(ModelEntity).filter(ModelEntity.id == payload.model_id).first()
    quant = db.query(ModelQuantEntity).filter(ModelQuantEntity.id == payload.quant_id).first()
    if not model or not quant:
        raise HTTPException(status_code=404, detail="Model or quant not found")
    hf_repo = quant.hf_repo or model.hf_repo or model.model_key
    vllm_cmd = _build_vllm_serve_cmd(hf_repo, payload.flags)
    commands = [
        "tmux kill-session -t inferix-vllm 2>/dev/null || true",
        (
            f"tmux new-session -d -s inferix-vllm "
            f"\"export PATH=$HOME/.local/bin:$PATH; "
            f"export HF_TOKEN=$INFERIX_HF_TOKEN; "
            f"{vllm_cmd} 2>&1 | tee /tmp/vllm.log\""
        ),
        "sleep 2 && echo '[+] vLLM launched in tmux session: inferix-vllm'",
        "echo '[+] Monitor: tail -f /tmp/vllm.log'",
    ]
    task_run = _make_pipeline_task(
        "lab.pipeline.run_model", payload.server_id, payload.session_id,
        {"pipeline_step": "run_model", "hf_repo": hf_repo,
         "remote_port": payload.flags.remote_port,
         "model_id": str(payload.model_id), "quant_id": str(payload.quant_id)}, db,
    )
    background_tasks.add_task(
        run_pipeline_step_task,
        task_run_id=str(task_run.id),
        session_id=str(payload.session_id),
        commands=commands,
        step_name=f"launch {hf_repo}",
    )
    return PipelineStartResponse(task_run_id=task_run.id, status="PENDING")


@router.post("/pipeline/stop-model", response_model=PipelineStartResponse, status_code=202)
def pipeline_stop_model(
    payload: PipelineStepRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> PipelineStartResponse:
    """Kill the inferix-vllm tmux session."""
    _require_pipeline_session(payload.session_id, payload.server_id, db)
    commands = [
        "tmux kill-session -t inferix-vllm 2>/dev/null && echo '[+] vLLM session stopped' || echo '[+] No running session found'",
    ]
    task_run = _make_pipeline_task(
        "lab.pipeline.stop_model", payload.server_id, payload.session_id,
        {"pipeline_step": "stop_model"}, db,
    )
    background_tasks.add_task(
        run_pipeline_step_task,
        task_run_id=str(task_run.id),
        session_id=str(payload.session_id),
        commands=commands,
        step_name="stop vLLM",
    )
    return PipelineStartResponse(task_run_id=task_run.id, status="PENDING")
