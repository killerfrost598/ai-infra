from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import Model, ModelQuant
from app.schemas.models import (
    HfImportRequest,
    HfImportResult,
    ModelCreate,
    ModelQuantCreate,
    ModelQuantResponse,
    ModelQuantUpdate,
    ModelResponse,
    ModelUpdate,
)
from app.services.hf_parser import parse_hf_model

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


# ── Model CRUD ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ModelResponse])
def list_models(
    family: str | None = Query(None),
    search: str | None = Query(None),
    archived: bool = Query(False),
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
    return q.order_by(Model.family, Model.param_count_b).all()


@router.get("/families", response_model=list[str])
def list_families(db: Session = Depends(get_db)) -> list[str]:
    rows = db.query(Model.family).filter(Model.is_archived == False).distinct().order_by(Model.family).all()
    return [r[0] for r in rows]


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


# ── HF import ─────────────────────────────────────────────────────────────────

@router.post("/import-from-hf", response_model=HfImportResult)
def import_from_hf(payload: HfImportRequest) -> HfImportResult:
    try:
        result = parse_hf_model(payload.hf_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"HuggingFace fetch failed: {exc}") from exc
    return HfImportResult(
        suggested=ModelCreate(**result["suggested"]),
        confidence=result["confidence"],
        raw_hf_repo=result["raw_hf_repo"],
    )
