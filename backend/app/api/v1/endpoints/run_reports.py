"""Run report endpoints — preview sanitized JSON and publish to GitHub."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import ModelRunAttempt
from app.services.run_report import build_report, sanitize_report, publish_to_github

router = APIRouter()


@router.get("/{run_id}/preview")
def preview_report(run_id: UUID, db: Session = Depends(get_db)) -> dict:
    """Return the sanitized JSON report for this run (no side effects)."""
    try:
        raw = build_report(run_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return sanitize_report(raw)


@router.post("/{run_id}/publish")
def publish_report(run_id: UUID, db: Session = Depends(get_db)) -> dict:
    """Sanitize the run report and push it to the configured GitHub repo.

    Stores published_url and published_sha on the ModelRunAttempt row.
    Returns {"url": str, "sha": str}.
    """
    run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    try:
        raw = build_report(run_id, db)
        sanitized = sanitize_report(raw)
        result = publish_to_github(run_id, sanitized, db)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub publish failed: {exc}") from exc

    run.published_url = result["url"]
    run.published_sha = result["sha"]
    run.published_at = datetime.now(timezone.utc)
    db.commit()

    return result
