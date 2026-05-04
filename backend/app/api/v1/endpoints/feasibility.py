import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import HostCapabilitySnapshot, ModelVariant, Server
from app.services.compat.feasibility import CheckResult, FeasibilityReport, run_feasibility

router = APIRouter()


class FeasibilityRequest(BaseModel):
    server_id: str | None = None
    offer_id: int | None = None
    model_key: str
    quant: str
    engine: str = "VLLM"
    tp_size: int = 1


class CheckResultOut(BaseModel):
    id: str
    status: str
    reason: str
    source: str


class FeasibilityReportOut(BaseModel):
    verdict: str
    mode: str
    gpu_profile_key: str | None
    stack_matrix_id: int | None
    checks: list[CheckResultOut]


def _check_to_out(c: CheckResult) -> CheckResultOut:
    return CheckResultOut(id=c.id, status=c.status, reason=c.reason, source=c.source)


def _report_to_out(r: FeasibilityReport) -> FeasibilityReportOut:
    return FeasibilityReportOut(
        verdict=r.verdict,
        mode=r.mode,
        gpu_profile_key=r.gpu_profile_key,
        stack_matrix_id=r.stack_matrix_id,
        checks=[_check_to_out(c) for c in r.checks],
    )


def _get_redis():
    import redis as _redis
    return _redis.from_url("redis://redis:6379/2", decode_responses=True, socket_connect_timeout=2)


@router.post("", response_model=FeasibilityReportOut)
def check_feasibility(req: FeasibilityRequest, db: Session = Depends(get_db)) -> FeasibilityReportOut:
    variant = db.query(ModelVariant).filter_by(model_key=req.model_key, quant=req.quant).first()
    if not variant:
        raise HTTPException(422, f"ModelVariant not found for ({req.model_key}, {req.quant})")

    gpu_name: str | None = None
    vram_gb_total: int | None = None
    gpu_count: int = 1
    driver_version: str | None = None
    snapshot: HostCapabilitySnapshot | None = None

    if req.server_id:
        server = db.query(Server).filter_by(id=req.server_id).first()
        if not server:
            raise HTTPException(404, "server_id not found")
        gpu_name = server.gpu_model
        vram_gb_total = server.vram_gb
        snapshot = (
            db.query(HostCapabilitySnapshot)
            .filter_by(server_id=server.id)
            .order_by(HostCapabilitySnapshot.captured_at.desc())
            .first()
        )
        if snapshot:
            driver_version = snapshot.driver_version
            gpu_count = snapshot.gpu_count or 1

    elif req.offer_id is not None:
        # Try Redis cache for Clore offers
        try:
            r = _get_redis()
            cached = r.get("clore:offers:raw")
            if cached:
                offers = json.loads(cached)
                for o in offers:
                    oid = o.get("id") or o.get("offer_id")
                    try:
                        if int(str(oid)) == req.offer_id:
                            gpu_name = o.get("gpu_name")
                            vram_gb_total = o.get("vram_gb", 0) * o.get("gpu_count", 1)
                            gpu_count = o.get("gpu_count", 1)
                            break
                    except (TypeError, ValueError):
                        continue
        except Exception:
            pass
        if not gpu_name:
            raise HTTPException(404, f"offer_id {req.offer_id} not found in cache. Fetch offers first.")
    else:
        raise HTTPException(422, "Provide either server_id or offer_id")

    report = run_feasibility(
        db=db,
        gpu_name=gpu_name,
        vram_gb_total=vram_gb_total,
        gpu_count=gpu_count,
        driver_version=driver_version,
        snapshot=snapshot,
        model_key=req.model_key,
        quant=req.quant,
        engine=req.engine,
        tp_size=req.tp_size,
    )
    return _report_to_out(report)
