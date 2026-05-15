"""HTTP endpoints for per-file model downloads with SSE progress streaming."""

from __future__ import annotations

import asyncio
import json
import queue

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.model_download import (
    CancelResponse,
    DownloadSnapshot,
    DownloadStartResponse,
    ModelDownloadStartRequest,
)
from app.services.model_download.runner import (
    attach,
    cancel_download,
    get_download_status,
    start_model_download,
)

router = APIRouter()


@router.post("", response_model=DownloadStartResponse, status_code=202)
def start_download(
    payload: ModelDownloadStartRequest,
    db: Session = Depends(get_db),
) -> DownloadStartResponse:
    """Resolve file list, start remote download, return download_id + initial file list."""
    try:
        result = start_model_download(
            db=db,
            server_id=payload.server_id,
            session_id=payload.session_id,
            model_id=payload.model_id,
            quant_id=payload.quant_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return DownloadStartResponse(
        download_id=result.download_id,
        task_run_id=result.task_run_id,
        repo_id=result.repo_id,
        files=result.files,
        total_bytes=result.total_bytes,
        cached_bytes=result.cached_bytes,
    )


@router.get("/{download_id:path}/stream")
async def stream_download(download_id: str, request: Request) -> StreamingResponse:
    """SSE stream of DownloadSnapshot events. Emits event:complete on finish."""
    session = attach(download_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Download not found")
    event_queue = session.subscribe()

    async def _generate():
        try:
            snap = session.snapshot()
            yield f"data: {json.dumps(snap)}\n\n"

            if session.finished_at is not None:
                snap["event_type"] = "complete"
                yield f"event: complete\ndata: {json.dumps(snap)}\n\n"
                return

            while True:
                if await request.is_disconnected():
                    return
                try:
                    ev = await asyncio.to_thread(event_queue.get, True, 10.0)
                except queue.Empty:
                    yield ": keepalive\n\n"
                    continue

                if ev.get("event_type") == "complete":
                    yield f"event: complete\ndata: {json.dumps(ev)}\n\n"
                    return

                yield f"data: {json.dumps(ev)}\n\n"
        finally:
            session.unsubscribe(event_queue)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/{download_id:path}/cancel", response_model=CancelResponse)
def cancel(download_id: str) -> CancelResponse:
    """Signal cancellation. Non-destructive if already finished."""
    cancelled = cancel_download(download_id)
    return CancelResponse(cancelled=cancelled)


@router.get("/{download_id:path}", response_model=DownloadSnapshot)
def get_download(download_id: str) -> DownloadSnapshot:
    """Return current snapshot for an active or finished download."""
    snap = get_download_status(download_id)
    if snap is None:
        raise HTTPException(status_code=404, detail="Download not found")
    return DownloadSnapshot(**snap)
