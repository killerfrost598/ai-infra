import json
import re
import uuid
from pathlib import Path

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.entities import GpuProfile, ModelVariant, StackMatrix
from app.services.compat.cc_utils import cc_gte as _cc_gte

_SEEDS_DIR = Path(__file__).parent.parent.parent / "seeds"

_REDIS_CC_MAP_KEY = "gpu:cc_map:v1"
_REDIS_PROFILES_KEY = "gpu:profiles:v1"
_REDIS_TTL = 0  # no expiry — static data, invalidated only on restart


def load_seeds(db: Session) -> None:
    _seed_gpu_profiles(db)
    _seed_cc_profiles(db)
    _seed_stack_matrix(db)
    _seed_model_variants(db)
    _write_gpu_cache_to_redis(db)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _caps_from_cc(cc: str) -> dict:
    """Derive capability flags from CC string for CC-only (non-full-profile) entries."""
    return {
        "bf16":       _cc_gte(cc, "8.0"),
        "fp8_native": _cc_gte(cc, "8.9"),
        "marlin":     _cc_gte(cc, "8.0"),
        "fa2":        _cc_gte(cc, "8.0"),
        "fa3":        _cc_gte(cc, "9.0"),
    }


def _seed_gpu_profiles(db: Session) -> None:
    """Upsert the 12 validated rent-target profiles (full capability data)."""
    path = _SEEDS_DIR / "gpu_profiles.json"
    if not path.exists():
        return
    rows = json.loads(path.read_text())
    for row in rows:
        values = {**row, "is_full_profile": True}
        stmt = pg_insert(GpuProfile).values(**values).on_conflict_do_update(
            index_elements=["model_key"],
            set_={k: v for k, v in values.items() if k != "model_key"},
        )
        db.execute(stmt)
    db.commit()


def _seed_cc_profiles(db: Session) -> None:
    """Upsert CC-only entries from cuda_capability_seed.json.

    Full profiles always win — any model_key already in gpu_profiles (is_full_profile=True)
    is skipped. New entries get capability flags derived from CC.
    """
    path = _SEEDS_DIR / "cuda_capability_seed.json"
    if not path.exists():
        return
    entries = json.loads(path.read_text())
    for entry in entries:
        name: str = entry.get("name", "")
        if not name:
            continue
        cc: str = entry.get("cc", "")
        if not cc:
            continue
        arch: str = entry.get("arch", "unknown")
        aliases: list = entry.get("aliases") or []
        model_key = _slug(name)

        caps = _caps_from_cc(cc)
        values = {
            "model_key":       model_key,
            "display_name":    name,
            "aliases":         aliases,
            "arch":            arch,
            "cc":              cc,
            "vram_gb":         None,
            "is_full_profile": False,
            **caps,
        }
        # Only update if not already a full profile — full profiles take precedence
        stmt = (
            pg_insert(GpuProfile)
            .values(**values)
            .on_conflict_do_update(
                index_elements=["model_key"],
                set_={k: v for k, v in values.items() if k != "model_key"},
                where=GpuProfile.is_full_profile.is_(False),
            )
        )
        db.execute(stmt)
    db.commit()


def _seed_stack_matrix(db: Session) -> None:
    path = _SEEDS_DIR / "stack_matrix.json"
    if not path.exists():
        return
    if db.query(StackMatrix).count() > 0:
        return
    rows = json.loads(path.read_text())
    for row in rows:
        db.add(StackMatrix(**row))
    db.commit()


def _seed_model_variants(db: Session) -> None:
    path = _SEEDS_DIR / "model_variants.json"
    if not path.exists():
        return
    rows = json.loads(path.read_text())
    for row in rows:
        existing = db.query(ModelVariant).filter_by(
            model_key=row["model_key"], quant=row["quant"]
        ).first()
        if existing:
            for k, v in row.items():
                if k not in ("model_key", "quant"):
                    setattr(existing, k, v)
        else:
            db.add(ModelVariant(id=uuid.uuid4(), **row))
    db.commit()


def _write_gpu_cache_to_redis(db: Session) -> None:
    """Write alias→CC hash and full profile list to Redis after seeding."""
    try:
        import redis as _redis
        from app.core.config import settings
        r = _redis.from_url(settings.redis_cache_url, decode_responses=True, socket_connect_timeout=2)

        profiles = db.query(GpuProfile).all()

        # Build alias→CC hash for fast cc_lookup()
        cc_map: dict[str, str] = {}
        for p in profiles:
            if not p.cc:
                continue
            for alias in ([p.display_name] + (p.aliases or [])):
                if alias:
                    cc_map[alias.lower()] = p.cc

        if cc_map:
            r.hset(_REDIS_CC_MAP_KEY, mapping=cc_map)

        # Serialise full profile list for the API endpoint
        profile_list = [
            {
                "model_key":       p.model_key,
                "display_name":    p.display_name,
                "aliases":         p.aliases or [],
                "arch":            p.arch,
                "cc":              p.cc,
                "vram_gb":         p.vram_gb,
                "fp8_native":      p.fp8_native,
                "bf16":            p.bf16,
                "marlin":          p.marlin,
                "fa2":             p.fa2,
                "fa3":             p.fa3,
                "is_full_profile": p.is_full_profile,
                "notes":           p.notes,
            }
            for p in profiles
        ]
        r.set(_REDIS_PROFILES_KEY, json.dumps(profile_list))

    except Exception:
        pass  # Redis unavailable at seed time — cc_lookup falls back to JSON files
