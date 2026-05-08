import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.cache import get_redis_client
from app.db.session import get_db
from app.models.entities import GpuProfile

router = APIRouter()

_REDIS_KEY = "gpu:profiles:v1"


class GpuProfileResponse(BaseModel):
    model_key: str
    display_name: str
    aliases: list[str]
    arch: str
    cc: str
    vram_gb: int | None
    fp8_native: bool
    bf16: bool
    marlin: bool
    fa2: bool
    fa3: bool
    is_full_profile: bool
    notes: str | None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[GpuProfileResponse])
def list_gpu_profiles(db: Session = Depends(get_db)) -> list[GpuProfileResponse]:
    """Return all GPU profiles. Redis-cached; falls back to DB."""
    try:
        r = get_redis_client()
        raw = r.get(_REDIS_KEY)
        if raw:
            return [GpuProfileResponse(**row) for row in json.loads(raw)]
    except Exception:
        pass

    profiles = db.query(GpuProfile).order_by(GpuProfile.cc.desc(), GpuProfile.display_name).all()
    result = [GpuProfileResponse.model_validate(p) for p in profiles]

    # Backfill Redis for next request
    try:
        r = get_redis_client()
        r.set(_REDIS_KEY, json.dumps([p.model_dump() for p in result]))
    except Exception:
        pass

    return result
