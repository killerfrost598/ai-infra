from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import cast, exists, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import Model, ModelQuant, TaskRun
from app.schemas.models import (
    ModelCreate,
    ModelQuantCreate,
    ModelQuantResponse,
    ModelQuantUpdate,
    ModelResponse,
    ModelUpdate,
    SeedRequest,
    SeedResponse,
    SyncStatus,
)
router = APIRouter()


def _get_model_or_404(model_id: UUID, db: Session) -> Model:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    return m


def _get_quant_or_404(model_id: UUID, quant_id: UUID, db: Session) -> ModelQuant:
    q = db.query(ModelQuant).filter(
        ModelQuant.id == quant_id, ModelQuant.model_id == model_id
    ).first()
    if not q:
        raise HTTPException(status_code=404, detail="Quant not found")
    return q


# ── Model list + filters ──────────────────────────────────────────────────────

@router.get("", response_model=list[ModelResponse])
def list_models(
    family: str | None = Query(None),
    search: str | None = Query(None),
    archived: bool = Query(False),
    use_case: str | None = Query(None),
    source: str | None = Query(None),
    is_reasoning: bool | None = Query(None),
    supports_tools: bool | None = Query(None),
    is_code_model: bool | None = Query(None),
    is_moe: bool | None = Query(None),
    tag: str | None = Query(None, description="Filter models that carry this tag"),
    param_min: float | None = Query(None),
    param_max: float | None = Query(None),
    gated: bool | None = Query(None, description="True = only gated models, False = only ungated"),
    quant_format: str | None = Query(None, description="Filter models with at least one quant of this format"),
    sort: str | None = Query(None, description="downloads | likes | params | created | name (default)"),
    db: Session = Depends(get_db),
) -> list[Model]:
    q = db.query(Model).filter(Model.is_archived == archived)

    if family:
        q = q.filter(Model.family.ilike(f"%{family}%"))
    if search:
        term = f"%{search}%"
        q = q.filter(
            (Model.name.ilike(term)) | (Model.model_key.ilike(term)) | (Model.family.ilike(term))
        )
    if use_case:
        q = q.filter(Model.use_case == use_case)
    if source:
        q = q.filter(Model.source == source)
    if is_reasoning is not None:
        q = q.filter(Model.is_reasoning == is_reasoning)
    if supports_tools is not None:
        q = q.filter(Model.supports_tools == supports_tools)
    if is_code_model is not None:
        q = q.filter(Model.is_code_model == is_code_model)
    if is_moe is not None:
        q = q.filter(Model.is_moe == is_moe)
    if tag:
        q = q.filter(cast(Model.tags, JSONB).contains([tag]))
    if param_min is not None:
        q = q.filter(Model.param_count_b >= param_min)
    if param_max is not None:
        q = q.filter(Model.param_count_b <= param_max)
    if gated is not None:
        if gated:
            q = q.filter(Model.gated.isnot(None))
        else:
            q = q.filter(Model.gated.is_(None))
    if quant_format:
        q = q.filter(
            exists().where(
                (ModelQuant.model_id == Model.id) & (ModelQuant.quant_format == quant_format)
            )
        )

    if sort == "downloads":
        q = q.order_by(Model.hf_downloads.desc().nullslast())
    elif sort == "likes":
        q = q.order_by(Model.hf_likes.desc().nullslast())
    elif sort == "params":
        q = q.order_by(Model.param_count_b.desc())
    elif sort == "created":
        q = q.order_by(Model.hf_created_at.desc().nullslast())
    else:
        q = q.order_by(Model.family, Model.param_count_b)

    return q.all()


# ── Static sub-routes (must be before /{model_id}) ───────────────────────────

@router.get("/families", response_model=list[str])
def list_families(db: Session = Depends(get_db)) -> list[str]:
    rows = (
        db.query(Model.family)
        .filter(Model.is_archived == False)  # noqa: E712
        .distinct()
        .order_by(Model.family)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/tag-vocabulary", response_model=list[str])
def tag_vocabulary(db: Session = Depends(get_db)) -> list[str]:
    rows = db.execute(
        text(
            "SELECT DISTINCT jsonb_array_elements_text(tags::jsonb) AS t "
            "FROM models WHERE NOT is_archived ORDER BY t"
        )
    ).fetchall()
    return [r[0] for r in rows if r[0]]


@router.get("/sync-status", response_model=SyncStatus)
def sync_status(db: Session = Depends(get_db)) -> SyncStatus:
    last = (
        db.query(TaskRun)
        .filter(TaskRun.task_type.in_(["models.seed_one", "models.seed_all"]))
        .order_by(TaskRun.created_at.desc())
        .first()
    )
    if not last:
        return SyncStatus(
            task_type=None, status=None, started_at=None,
            finished_at=None, duration_seconds=None,
            error_summary=None, metadata=None,
        )
    return SyncStatus(
        task_type=last.task_type,
        status=last.status.value if last.status else None,
        started_at=last.started_at,
        finished_at=last.finished_at,
        duration_seconds=last.duration_seconds,
        error_summary=last.error_summary,
        metadata=last.metadata_json,
    )


# ── Model CRUD ────────────────────────────────────────────────────────────────

@router.post("", response_model=ModelResponse, status_code=201)
def create_model(payload: ModelCreate, db: Session = Depends(get_db)) -> Model:
    existing = db.query(Model).filter(Model.model_key == payload.model_key).first()
    if existing:
        raise HTTPException(status_code=409, detail="model_key already exists")

    quants_data = payload.quants
    model_data = payload.model_dump(exclude={"quants"})
    model = Model(**model_data)
    db.add(model)
    db.flush()

    for qdata in quants_data:
        db.add(ModelQuant(model_id=model.id, **qdata.model_dump()))

    db.commit()
    db.refresh(model)
    return model


@router.get("/{model_id}", response_model=ModelResponse)
def get_model(model_id: UUID, db: Session = Depends(get_db)) -> Model:
    return _get_model_or_404(model_id, db)


@router.patch("/{model_id}", response_model=ModelResponse)
def update_model(model_id: UUID, payload: ModelUpdate, db: Session = Depends(get_db)) -> Model:
    model = _get_model_or_404(model_id, db)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(model, field, value)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/{model_id}", status_code=204)
def delete_model(model_id: UUID, db: Session = Depends(get_db)) -> None:
    model = _get_model_or_404(model_id, db)
    db.delete(model)
    db.commit()


# ── Quant CRUD ────────────────────────────────────────────────────────────────

@router.get("/{model_id}/quants", response_model=list[ModelQuantResponse])
def list_quants(model_id: UUID, db: Session = Depends(get_db)) -> list[ModelQuant]:
    _get_model_or_404(model_id, db)
    return (
        db.query(ModelQuant)
        .filter(ModelQuant.model_id == model_id)
        .order_by(ModelQuant.quality_score.desc())
        .all()
    )


@router.post("/{model_id}/quants", response_model=ModelQuantResponse, status_code=201)
def add_quant(model_id: UUID, payload: ModelQuantCreate, db: Session = Depends(get_db)) -> ModelQuant:
    _get_model_or_404(model_id, db)
    existing = db.query(ModelQuant).filter(
        ModelQuant.model_id == model_id, ModelQuant.name == payload.name
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Quant name already exists for this model")
    q = ModelQuant(model_id=model_id, **payload.model_dump())
    db.add(q)
    db.commit()
    db.refresh(q)
    return q


@router.patch("/{model_id}/quants/{quant_id}", response_model=ModelQuantResponse)
def update_quant(
    model_id: UUID, quant_id: UUID, payload: ModelQuantUpdate, db: Session = Depends(get_db)
) -> ModelQuant:
    q = _get_quant_or_404(model_id, quant_id, db)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(q, field, value)
    db.commit()
    db.refresh(q)
    return q


@router.delete("/{model_id}/quants/{quant_id}", status_code=204)
def delete_quant(model_id: UUID, quant_id: UUID, db: Session = Depends(get_db)) -> None:
    q = _get_quant_or_404(model_id, quant_id, db)
    db.delete(q)
    db.commit()


# ── HF seeder endpoints ───────────────────────────────────────────────────────

@router.post("/seed", response_model=SeedResponse, status_code=202)
def seed_model(payload: SeedRequest, db: Session = Depends(get_db)) -> SeedResponse:
    if "/" not in payload.repo_id:
        raise HTTPException(status_code=422, detail="repo_id must be in 'org/repo' format")
    from app.workers.tasks import seed_model_from_hf
    result = seed_model_from_hf.delay(payload.repo_id)
    return SeedResponse(celery_task_id=result.id, repo_id=payload.repo_id)


@router.post("/refresh-all", status_code=202)
def refresh_all_models(db: Session = Depends(get_db)) -> dict:
    count = (
        db.query(Model)
        .filter(Model.source == "hf", Model.is_archived == False)  # noqa: E712
        .count()
    )
    from app.workers.tasks import seed_all_models
    result = seed_all_models.delay()
    return {"celery_task_id": result.id, "queued": count}
