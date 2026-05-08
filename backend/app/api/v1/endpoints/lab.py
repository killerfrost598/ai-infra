"""Lab API — recommendation, PTY inject, and live observation endpoints."""

import asyncio
import logging
import time
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import EngineKind, FailureStage, ModelRunAttempt, RunStatus
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
from app.schemas.deployment_plan import DeploymentPlanRequest, DeploymentPlanResponse
from app.schemas.model_runs import ModelRunAttemptResponse
from app.services.ai_deploy_assistant import build_deploy_context, choose_provider, generate_deploy_guidance
from app.services.deployments.planner import build_deployment_plan
from app.services import session_store
from app.services.lab_recommender import recommend_launch
from app.services.session_runner import execute_command

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
            recommendation.injectable_command,
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
