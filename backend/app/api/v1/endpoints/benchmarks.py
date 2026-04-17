from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import InferenceBenchmark
from app.schemas.benchmarks import (
    InferenceBenchmarkCreate,
    InferenceBenchmarkListResponse,
    InferenceBenchmarkResponse,
)

router = APIRouter()


@router.get("", response_model=InferenceBenchmarkListResponse)
def list_benchmarks(
    gpu_model: str | None = Query(None, description="Filter by GPU model (case-insensitive substring)"),
    model_name: str | None = Query(None, description="Filter by model name (case-insensitive substring)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> InferenceBenchmarkListResponse:
    """List inference benchmark records, optionally filtered by GPU or model name."""
    q = db.query(InferenceBenchmark)
    if gpu_model:
        q = q.filter(InferenceBenchmark.gpu_model.ilike(f"%{gpu_model}%"))
    if model_name:
        q = q.filter(InferenceBenchmark.model_name.ilike(f"%{model_name}%"))
    total = q.count()
    items = q.order_by(InferenceBenchmark.created_at.desc()).offset(skip).limit(limit).all()
    return InferenceBenchmarkListResponse(items=items, total=total)


@router.post("", response_model=InferenceBenchmarkResponse, status_code=201)
def create_benchmark(
    payload: InferenceBenchmarkCreate,
    db: Session = Depends(get_db),
) -> InferenceBenchmark:
    """Record a new inference benchmark result."""
    benchmark = InferenceBenchmark(**payload.model_dump())
    db.add(benchmark)
    db.commit()
    db.refresh(benchmark)
    return benchmark


@router.get("/gpu/{gpu_model}", response_model=InferenceBenchmarkListResponse)
def list_benchmarks_for_gpu(
    gpu_model: str,
    model_name: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> InferenceBenchmarkListResponse:
    """All benchmark records for a specific GPU model (exact match, case-insensitive)."""
    q = db.query(InferenceBenchmark).filter(
        InferenceBenchmark.gpu_model.ilike(gpu_model)
    )
    if model_name:
        q = q.filter(InferenceBenchmark.model_name.ilike(f"%{model_name}%"))
    total = q.count()
    items = q.order_by(InferenceBenchmark.tokens_per_second_avg.desc().nullslast()).offset(skip).limit(limit).all()
    return InferenceBenchmarkListResponse(items=items, total=total)


@router.delete("/{benchmark_id}", status_code=204)
def delete_benchmark(benchmark_id: UUID, db: Session = Depends(get_db)) -> None:
    """Delete a benchmark record."""
    b = db.query(InferenceBenchmark).filter(InferenceBenchmark.id == benchmark_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Benchmark not found")
    db.delete(b)
    db.commit()
