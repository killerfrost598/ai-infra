from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import StackMatrix, TaskRun, TaskStatus

router = APIRouter()


class ScrapeRun(BaseModel):
    task_run_id: str
    status: str
    started_at: str | None
    finished_at: str | None
    candidates: list[dict] | None


class ApproveCandidate(BaseModel):
    engine: str
    version: str
    cc_min: str
    cc_max: str | None = None
    driver_min: str = "525.85"
    cuda_runtime: str = "12.1"
    torch: str = "2.3.0"
    container_image: str | None = None
    pip_index_url: str | None = None
    priority: int = 10


@router.get("/scrape-runs", response_model=list[ScrapeRun])
def list_scrape_runs(
    limit: int = 20,
    db: Session = Depends(get_db),
) -> list[ScrapeRun]:
    rows = (
        db.query(TaskRun)
        .filter(TaskRun.task_type == "compat.scrape_versions")
        .order_by(TaskRun.created_at.desc())
        .limit(limit)
        .all()
    )
    result = []
    for r in rows:
        candidates = None
        if r.metadata_json and isinstance(r.metadata_json, dict):
            candidates = r.metadata_json.get("candidates")
        result.append(ScrapeRun(
            task_run_id=str(r.id),
            status=r.status.value if r.status else "unknown",
            started_at=str(r.started_at) if r.started_at else None,
            finished_at=str(r.finished_at) if r.finished_at else None,
            candidates=candidates,
        ))
    return result


@router.post("/scrape-runs/trigger", status_code=202)
def trigger_scrape() -> dict:
    """Manually trigger a compat version scrape."""
    from app.workers.tasks import scrape_versions
    result = scrape_versions.delay()
    return {"task_id": result.id, "status": "queued"}


@router.post("/candidates/approve", response_model=dict, status_code=201)
def approve_candidate(payload: ApproveCandidate, db: Session = Depends(get_db)) -> dict:
    """Create a new StackMatrix row for an approved candidate version."""
    engine_lower = payload.engine.lower()
    existing = db.query(StackMatrix).filter(
        StackMatrix.cc_min == payload.cc_min,
        StackMatrix.is_active == True,  # noqa: E712
    ).all()

    if engine_lower == "vllm":
        conflict = next((s for s in existing if s.vllm == payload.version), None)
    else:
        conflict = next((s for s in existing if s.sglang == payload.version), None)

    if conflict:
        raise HTTPException(status_code=409, detail=f"Stack with {payload.engine}=={payload.version} for CC>={payload.cc_min} already exists (id={conflict.id})")

    row = StackMatrix(
        cc_min=payload.cc_min,
        cc_max=payload.cc_max,
        driver_min=payload.driver_min,
        cuda_runtime=payload.cuda_runtime,
        torch=payload.torch,
        vllm=payload.version if engine_lower == "vllm" else None,
        sglang=payload.version if engine_lower == "sglang" else None,
        container_image=payload.container_image,
        pip_index_url=payload.pip_index_url,
        priority=payload.priority,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"stack_matrix_id": row.id, "status": "created"}
