"""Model run attempts — capture, update, and aggregate test-run outcomes."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import (
    EngineKind,
    FailureStage,
    Model,
    ModelQuant,
    ModelRunAttempt,
    RunStatus,
    Server,
)
from app.schemas.model_runs import (
    ModelRunAggregate,
    ModelRunAttemptCreate,
    ModelRunAttemptResponse,
    ModelRunAttemptUpdate,
    ModelRunListResponse,
)

router = APIRouter()


def _to_response(run: ModelRunAttempt) -> ModelRunAttemptResponse:
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


@router.post("", response_model=ModelRunAttemptResponse, status_code=201)
def create_run(payload: ModelRunAttemptCreate, db: Session = Depends(get_db)) -> ModelRunAttemptResponse:
    """Record a new model run attempt (status PLANNED)."""
    if not db.query(Server).filter(Server.id == payload.server_id).first():
        raise HTTPException(status_code=404, detail="Server not found")
    if not db.query(Model).filter(Model.id == payload.model_id).first():
        raise HTTPException(status_code=404, detail="Model not found")
    if not db.query(ModelQuant).filter(ModelQuant.id == payload.quant_id).first():
        raise HTTPException(status_code=404, detail="ModelQuant not found")

    try:
        engine = EngineKind(payload.engine.upper())
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown engine '{payload.engine}'")

    run = ModelRunAttempt(
        server_id=payload.server_id,
        session_id=payload.session_id,
        model_id=payload.model_id,
        quant_id=payload.quant_id,
        host_snapshot_id=payload.host_snapshot_id,
        task_run_id=payload.task_run_id,
        engine=engine,
        engine_version=payload.engine_version,
        mode=payload.mode,
        container_image=payload.container_image,
        launch_command=payload.launch_command,
        launch_plan_json=payload.launch_plan_json,
        feasibility_verdict=payload.feasibility_verdict,
        forced=payload.forced,
        status=RunStatus.PLANNED,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return _to_response(run)


@router.get("", response_model=ModelRunListResponse)
def list_runs(
    server_id: UUID | None = Query(None),
    model_id: UUID | None = Query(None),
    quant_id: UUID | None = Query(None),
    succeeded: bool | None = Query(None),
    status: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ModelRunListResponse:
    """List run attempts with optional filters."""
    q = db.query(ModelRunAttempt)
    if server_id is not None:
        q = q.filter(ModelRunAttempt.server_id == server_id)
    if model_id is not None:
        q = q.filter(ModelRunAttempt.model_id == model_id)
    if quant_id is not None:
        q = q.filter(ModelRunAttempt.quant_id == quant_id)
    if succeeded is not None:
        q = q.filter(ModelRunAttempt.succeeded == succeeded)
    if status is not None:
        q = q.filter(ModelRunAttempt.status == status)

    total = q.count()
    runs = q.order_by(ModelRunAttempt.started_at.desc()).offset(skip).limit(limit).all()
    return ModelRunListResponse(items=[_to_response(r) for r in runs], total=total)


@router.get("/aggregate", response_model=list[ModelRunAggregate])
def aggregate_runs(
    model_id: UUID | None = Query(None),
    quant_id: UUID | None = Query(None),
    db: Session = Depends(get_db),
) -> list[ModelRunAggregate]:
    """Aggregate success rate and avg TPS per (model_id, quant_id) pair."""
    q = db.query(
        ModelRunAttempt.model_id,
        ModelRunAttempt.quant_id,
        func.count(ModelRunAttempt.id).label("total"),
        func.sum(case((ModelRunAttempt.succeeded == True, 1), else_=0)).label("successful"),
        func.avg(ModelRunAttempt.tps_steady).label("avg_tps"),
    )
    if model_id is not None:
        q = q.filter(ModelRunAttempt.model_id == model_id)
    if quant_id is not None:
        q = q.filter(ModelRunAttempt.quant_id == quant_id)

    rows = q.group_by(ModelRunAttempt.model_id, ModelRunAttempt.quant_id).all()

    result = []
    for row in rows:
        total = row.total or 0
        successful = int(row.successful or 0)
        result.append(
            ModelRunAggregate(
                model_id=row.model_id,
                quant_id=row.quant_id,
                total=total,
                successful=successful,
                success_rate=successful / total if total > 0 else 0.0,
                avg_tps=float(row.avg_tps) if row.avg_tps is not None else None,
            )
        )
    return result


@router.get("/{run_id}", response_model=ModelRunAttemptResponse)
def get_run(run_id: UUID, db: Session = Depends(get_db)) -> ModelRunAttemptResponse:
    """Get a single run attempt by ID."""
    run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return _to_response(run)


@router.patch("/{run_id}", response_model=ModelRunAttemptResponse)
def update_run(
    run_id: UUID,
    payload: ModelRunAttemptUpdate,
    db: Session = Depends(get_db),
) -> ModelRunAttemptResponse:
    """Update outcome, metrics, or notes for a run attempt."""
    run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if payload.status is not None:
        try:
            run.status = RunStatus(payload.status.upper())
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Unknown status '{payload.status}'")

    if payload.failure_stage is not None:
        try:
            run.failure_stage = FailureStage(payload.failure_stage.upper())
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Unknown failure_stage '{payload.failure_stage}'")

    for field in (
        "succeeded", "failure_message", "container_id",
        "ttft_ms", "tps_steady", "vram_used_gb",
        "health_check_url", "health_check_ok",
        "operator_notes", "completed_at", "duration_seconds",
    ):
        val = getattr(payload, field)
        if val is not None:
            setattr(run, field, val)

    db.commit()
    db.refresh(run)
    return _to_response(run)
