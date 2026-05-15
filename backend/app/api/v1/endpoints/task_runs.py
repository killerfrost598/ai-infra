import asyncio
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal, get_db
from app.models.entities import TaskRun, TaskStatus
from app.schemas.task_runs import TaskRunCreate, TaskRunListResponse, TaskRunResponse, TaskRunUpdate

router = APIRouter()

_TERMINAL: frozenset[TaskStatus] = frozenset({TaskStatus.SUCCESS, TaskStatus.FAILED, TaskStatus.PARTIAL})


def _safe_log_path(raw_path: str | None) -> Path | None:
    if not raw_path:
        return None
    try:
        base = Path(settings.logs_base_path).resolve()
        candidate = Path(raw_path).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    if candidate == base or base in candidate.parents:
        return candidate
    return None


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
    log_path = _safe_log_path(task_run.logs_path)
    if log_path is None:
        raise HTTPException(status_code=403, detail="Log path is outside the configured log directory")
    if not log_path.exists() or not log_path.is_file():
        raise HTTPException(status_code=404, detail="Log file not found on disk")
    with log_path.open(encoding="utf-8", errors="replace") as f:
        return f.read()


@router.get("/{task_run_id}/logs/stream")
async def stream_task_run_logs(task_run_id: UUID, request: Request) -> StreamingResponse:
    """Tail the task log as a Server-Sent Events stream.

    Emits ``data:`` events for each new chunk of log text.
    Emits ``event: done`` when the task reaches a terminal state, then closes.
    Suitable for use with the browser ``EventSource`` API.
    """
    # Initial lookup — separate short-lived session
    db = SessionLocal()
    try:
        task_run = db.query(TaskRun).filter(TaskRun.id == task_run_id).first()
        if not task_run:
            raise HTTPException(status_code=404, detail="Task run not found")
        log_path: str | None = task_run.logs_path
    finally:
        db.close()

    async def _generate():
        nonlocal log_path
        pos = 0  # character offset into the log file

        # Poll until the client disconnects or the task finishes
        while True:
            if await request.is_disconnected():
                break

            # Re-fetch task run status and log path from DB
            db2 = SessionLocal()
            try:
                tr = db2.query(TaskRun).filter(TaskRun.id == task_run_id).first()
                if tr is None:
                    break
                if log_path is None and tr.logs_path:
                    log_path = tr.logs_path
                is_done = tr.status in _TERMINAL
            finally:
                db2.close()

            # Stream any new log bytes
            safe_path = _safe_log_path(log_path)
            if safe_path and safe_path.exists() and safe_path.is_file():
                with safe_path.open(encoding="utf-8", errors="replace") as f:
                    f.seek(pos)
                    chunk = f.read()
                    if chunk:
                        pos += len(chunk)
                        # Send each line as a separate SSE data event so browsers
                        # receive content immediately without buffering a large frame.
                        for line in chunk.splitlines():
                            yield f"data: {line}\n\n"

            if is_done:
                yield "event: done\ndata: closed\n\n"
                break

            await asyncio.sleep(0.4)

    # If the task is already in terminal state and already_done, the generator
    # will flush the full log and immediately emit done — no long poll needed.
    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
