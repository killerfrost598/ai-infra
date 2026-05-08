from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session

from app.core.cache import get_redis_client
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


@router.get("/leaderboard")
def get_leaderboard(
    model_name: str | None = Query(None),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Aggregated GPU performance rankings with cost-efficiency metrics."""
    q = db.query(
        InferenceBenchmark.gpu_model,
        sqlfunc.count(InferenceBenchmark.id).label("samples"),
        sqlfunc.percentile_cont(0.5).within_group(
            InferenceBenchmark.tokens_per_second_avg.asc()
        ).label("tps_median"),
        sqlfunc.percentile_cont(0.5).within_group(
            InferenceBenchmark.ttft_ms_p95.asc()
        ).label("ttft_p95_median"),
        sqlfunc.percentile_cont(0.5).within_group(
            InferenceBenchmark.knee_concurrency.asc()
        ).label("knee_median"),
    ).filter(InferenceBenchmark.tokens_per_second_avg.isnot(None))
    if model_name:
        q = q.filter(InferenceBenchmark.model_name.ilike(f"%{model_name}%"))
    rows = (
        q.group_by(InferenceBenchmark.gpu_model)
        .order_by(sqlfunc.count(InferenceBenchmark.id).desc())
        .all()
    )

    # Fetch Clore price medians from Redis
    price_map: dict[str, float] = {}
    try:
        import json
        r = get_redis_client()
        cached = r.get("clore:offers:raw:v2")
        if cached:
            offers = json.loads(cached)
            gpu_prices: dict[str, list[float]] = {}
            for o in offers:
                gn = (o.get("gpu_name") or "").strip()
                price = o.get("price_per_day")
                if gn and price:
                    gpu_prices.setdefault(gn, []).append(float(price))
            for gn, prices in gpu_prices.items():
                prices.sort()
                price_map[gn] = prices[len(prices) // 2]
    except Exception:
        pass

    result = []
    for row in rows:
        tps = float(row.tps_median) if row.tps_median else 0.0
        price = price_map.get(row.gpu_model)
        cost_per_million = None
        if tps > 0 and price:
            cost_per_million = round(1_000_000 * price / (tps * 86400), 6)
        result.append({
            "gpu_model": row.gpu_model,
            "samples": row.samples,
            "tps_median": round(tps, 2),
            "ttft_p95_median": round(float(row.ttft_p95_median), 1) if row.ttft_p95_median else None,
            "knee_median": int(row.knee_median) if row.knee_median else None,
            "cost_per_million_tokens": cost_per_million,
        })
    return result


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


@router.post("/run/{deployment_id}", status_code=202)
def run_benchmark(
    deployment_id: UUID,
    profile: str = Query("default", pattern="^(quick|default|thorough)$"),
    db: Session = Depends(get_db),
) -> dict:
    """Trigger an async inference benchmark for the given deployment."""
    from app.models.entities import ModelDeployment
    deployment = db.query(ModelDeployment).filter(ModelDeployment.id == deployment_id).first()
    if not deployment:
        raise HTTPException(404, "Deployment not found")
    if not deployment.inference_base_url:
        raise HTTPException(
            422,
            "deployment.inference_base_url is not set — set it manually or deploy via Phase 4",
        )
    from app.workers.benchmark_tasks import run_benchmark as _task
    task_run_id = _schedule_task_run(deployment_id, profile, db)
    _task.delay(str(deployment_id), profile=profile)
    return {"task_run_id": str(task_run_id), "profile": profile}


def _schedule_task_run(deployment_id: UUID, profile: str, db: Session) -> UUID:
    from app.models.entities import TaskRun, TaskStatus
    from app.workers.tasks import _utcnow
    task_run = TaskRun(
        task_type="benchmarks.run",
        status=TaskStatus.PENDING,
        model_deployment_id=deployment_id,
        metadata_json={"deployment_id": str(deployment_id), "profile": profile},
    )
    db.add(task_run)
    db.commit()
    db.refresh(task_run)
    return task_run.id


@router.delete("/{benchmark_id}", status_code=204)
def delete_benchmark(benchmark_id: UUID, db: Session = Depends(get_db)) -> None:
    """Delete a benchmark record."""
    b = db.query(InferenceBenchmark).filter(InferenceBenchmark.id == benchmark_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Benchmark not found")
    db.delete(b)
    db.commit()
