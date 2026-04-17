from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import Playbook, Server
from app.schemas.playbooks import PlaybookCreate, PlaybookListResponse, PlaybookResponse, PlaybookUpdate

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
