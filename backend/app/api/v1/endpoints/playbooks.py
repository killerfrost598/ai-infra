from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import ModelVariant, Playbook, PlaybookRunOutcome, Server
from app.schemas.playbooks import PlaybookCreate, PlaybookListResponse, PlaybookResponse, PlaybookUpdate, RecommendedPlaybook

router = APIRouter()


@router.get("", response_model=PlaybookListResponse)
def list_playbooks(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> PlaybookListResponse:
    total = db.query(Playbook).count()
    items = db.query(Playbook).offset(skip).limit(limit).all()
    return PlaybookListResponse(items=items, total=total)


@router.post("", response_model=PlaybookResponse, status_code=201)
def create_playbook(payload: PlaybookCreate, db: Session = Depends(get_db)) -> Playbook:
    playbook = Playbook(**payload.model_dump())
    db.add(playbook)
    db.commit()
    db.refresh(playbook)
    return playbook


# /recommended must be registered before /{playbook_id} to avoid UUID parse error
@router.get("/recommended", response_model=list[RecommendedPlaybook])
def recommended_playbooks(
    model_key: str | None = Query(None),
    engine: str | None = Query(None),
    gpu_model: str | None = Query(None),
    min_runs: int = Query(1, ge=1),
    db: Session = Depends(get_db),
) -> list[RecommendedPlaybook]:
    """Return playbooks sorted by success rate for a given model+engine+GPU combo."""
    import sqlalchemy as sa

    total_col = func.count(PlaybookRunOutcome.id).label("total_runs")
    success_col = func.sum(
        func.cast(PlaybookRunOutcome.succeeded, sa.Integer)
    ).label("successful_runs")

    query = (
        db.query(Playbook, total_col, success_col)
        .join(PlaybookRunOutcome, PlaybookRunOutcome.playbook_id == Playbook.id)
    )

    if engine:
        from app.models.entities import EngineKind
        try:
            query = query.filter(Playbook.engine == EngineKind(engine.upper()))
        except ValueError:
            pass

    if gpu_model:
        query = query.filter(PlaybookRunOutcome.gpu_model.ilike(f"%{gpu_model}%"))

    if model_key:
        query = (
            query.join(ModelVariant, Playbook.model_variant_id == ModelVariant.id, isouter=True)
            .filter(
                (ModelVariant.model_key == model_key) | (Playbook.model_variant_id.is_(None))
            )
        )

    rows = (
        query.group_by(Playbook.id)
        .having(func.count(PlaybookRunOutcome.id) >= min_runs)
        .order_by(func.count(PlaybookRunOutcome.id).desc())
        .limit(10)
        .all()
    )

    results = []
    for playbook, total, success in rows:
        success_int = int(success or 0)
        total_int = int(total or 0)
        results.append(
            RecommendedPlaybook(
                playbook_id=playbook.id,
                playbook_name=playbook.name,
                engine=playbook.engine.value if playbook.engine else None,
                total_runs=total_int,
                successful_runs=success_int,
                success_rate=round(success_int / total_int, 4) if total_int > 0 else 0.0,
            )
        )

    return sorted(results, key=lambda r: r.success_rate, reverse=True)


@router.get("/{playbook_id}", response_model=PlaybookResponse)
def get_playbook(playbook_id: UUID, db: Session = Depends(get_db)) -> Playbook:
    playbook = db.query(Playbook).filter(Playbook.id == playbook_id).first()
    if not playbook:
        raise HTTPException(status_code=404, detail="Playbook not found")
    return playbook


@router.patch("/{playbook_id}", response_model=PlaybookResponse)
def update_playbook(playbook_id: UUID, payload: PlaybookUpdate, db: Session = Depends(get_db)) -> Playbook:
    playbook = db.query(Playbook).filter(Playbook.id == playbook_id).first()
    if not playbook:
        raise HTTPException(status_code=404, detail="Playbook not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(playbook, key, value)
    db.commit()
    db.refresh(playbook)
    return playbook


@router.delete("/{playbook_id}", status_code=204)
def delete_playbook(playbook_id: UUID, db: Session = Depends(get_db)) -> None:
    playbook = db.query(Playbook).filter(Playbook.id == playbook_id).first()
    if not playbook:
        raise HTTPException(status_code=404, detail="Playbook not found")
    db.delete(playbook)
    db.commit()


@router.post("/{playbook_id}/run", status_code=202)
def run_playbook(
    playbook_id: UUID,
    server_id: UUID = Query(..., description="ID of the server to run the playbook on"),
    db: Session = Depends(get_db),
) -> dict:
    """Dispatch a Celery task to clone and execute the playbook on a server."""
    playbook = db.query(Playbook).filter(Playbook.id == playbook_id).first()
    if not playbook:
        raise HTTPException(status_code=404, detail="Playbook not found")
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    from app.workers.tasks import run_playbook_task
    result = run_playbook_task.delay(str(server_id), str(playbook_id))
    return {"task_id": result.id, "status": "queued"}
