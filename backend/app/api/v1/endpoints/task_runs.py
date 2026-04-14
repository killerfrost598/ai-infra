import os
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import TaskRun
from app.schemas.task_runs import TaskRunCreate, TaskRunListResponse, TaskRunResponse, TaskRunUpdate

router = APIRouter()


@router.get("", response_model=TaskRunListResponse)
def list_task_runs(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    server_id: UUID | None = Query(None),
    db: Session = Depends(get_db),
) -> TaskRunListResponse:
    query = db.query(TaskRun)
    if server_id is not None:
        query = query.filter(TaskRun.server_id == server_id)
    total = query.count()
    items = query.order_by(TaskRun.created_at.desc()).offset(skip).limit(limit).all()
    return TaskRunListResponse(items=items, total=total)


@router.post("", response_model=TaskRunResponse, status_code=201)
def create_task_run(payload: TaskRunCreate, db: Session = Depends(get_db)) -> TaskRun:
    task_run = TaskRun(**payload.model_dump())
    db.add(task_run)
    db.commit()
    db.refresh(task_run)
    return task_run


@router.get("/{task_run_id}", response_model=TaskRunResponse)
def get_task_run(task_run_id: UUID, db: Session = Depends(get_db)) -> TaskRun:
    task_run = db.query(TaskRun).filter(TaskRun.id == task_run_id).first()
    if not task_run:
        raise HTTPException(status_code=404, detail="Task run not found")
    return task_run


@router.patch("/{task_run_id}", response_model=TaskRunResponse)
def update_task_run(task_run_id: UUID, payload: TaskRunUpdate, db: Session = Depends(get_db)) -> TaskRun:
    task_run = db.query(TaskRun).filter(TaskRun.id == task_run_id).first()
    if not task_run:
        raise HTTPException(status_code=404, detail="Task run not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(task_run, key, value)
    db.commit()
    db.refresh(task_run)
    return task_run


@router.get("/{task_run_id}/logs", response_class=PlainTextResponse)
def get_task_run_logs(task_run_id: UUID, db: Session = Depends(get_db)) -> str:
    """Return the raw log content for a task run."""
    task_run = db.query(TaskRun).filter(TaskRun.id == task_run_id).first()
    if not task_run:
        raise HTTPException(status_code=404, detail="Task run not found")
    if not task_run.logs_path:
        raise HTTPException(status_code=404, detail="No logs available for this task run")
    if not os.path.exists(task_run.logs_path):
        raise HTTPException(status_code=404, detail="Log file not found on disk")
    with open(task_run.logs_path) as f:
        return f.read()
