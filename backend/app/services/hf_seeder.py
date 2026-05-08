"""HuggingFace model seeder — entry point for DB upserts.

Orchestrates: hf_fetcher (I/O) → hf_parsers (pure transforms) → DB writes.
Applies a curated overlay from model_curation before writing model fields.

Entry point:
    seed_one_repo(repo_id, *, db, max_quants=None) -> Model
"""
from __future__ import annotations

import logging
import math
from typing import Any

from sqlalchemy.orm import Session

from app.models.entities import Model, ModelQuant, ModelVariant
from app.services.hf_fetcher import (
    _fetch_config_json,
    _fetch_model_info,
    _get_token,
    _list_quants,
    _make_api,
)
from app.services.hf_parsers import (
    _build_model_fields,
    _build_quant_dicts,
    _derive_recommended_engines,
)
from app.services.model_curation import apply_overlay

logger = logging.getLogger(__name__)


# ── ModelVariant bridge ───────────────────────────────────────────────────────

def _upsert_model_variant(db: Session, model: Model, mq: ModelQuant) -> None:
    """Keep model_variants in sync with model_quants so feasibility/selector queries work.

    feasibility.py and selector.py query model_variants by (model_key, quant).
    hf_seeder only writes model_quants, so without this bridge every HF-seeded
    model returns UNKNOWN from /feasibility.
    """
    quant_name = mq.name[:32]  # ModelVariant.quant is String(32)
    vram_min = max(1, math.ceil(mq.vram_weights_gb)) if mq.vram_weights_gb else 1
    cc_min = mq.cc_min or "7.5"
    context_default = (model.max_context_k * 1024) if model.max_context_k else 8192

    existing = (
        db.query(ModelVariant)
        .filter_by(model_key=model.model_key, quant=quant_name)
        .first()
    )
    fields: dict[str, Any] = {
        "model_key": model.model_key,
        "quant": quant_name,
        "vram_min_gb": vram_min,
        "cc_min": cc_min,
        "arch_supported_vllm": mq.arch_vllm,
        "arch_supported_sglang": mq.arch_sglang,
        "num_attention_heads": model.num_attention_heads,
        "tp_allowed_sizes": model.tp_allowed_sizes,
        "context_default": context_default,
        "hf_repo": mq.hf_repo,
    }
    if existing:
        for k, v in fields.items():
            setattr(existing, k, v)
    else:
        db.add(ModelVariant(**fields))


# ── Public entry point ────────────────────────────────────────────────────────

def seed_one_repo(
    repo_id: str,
    *,
    db: Session,
    max_quants: int | None = None,
) -> Model:
    """Fetch HF metadata for repo_id and upsert into the DB.

    - Creates the Model row when it doesn't exist.
    - Updates all HF-sourced fields on an existing row (source is set to 'hf').
    - Applies curated overlay from model_curation (no-op until inferix-models repo exists).
    - Deletes then re-inserts all quants (de-duplicated by name; highest-download wins).
    - Raises ValueError if HF returns an error for the repo.
    """
    token = _get_token(db)
    api = _make_api(token)

    info = _fetch_model_info(api, repo_id)
    if not info:
        raise ValueError(f"Could not fetch HF metadata for {repo_id!r}")

    org = repo_id.split("/", 1)[0] if "/" in repo_id else repo_id
    config_json = _fetch_config_json(repo_id, token)
    model_fields = _build_model_fields(info, config_json, org)

    # Merge curated overrides (e.g. recommended_flags, base_model corrections)
    overlay = apply_overlay(repo_id)
    for key in ("recommended_flags", "base_model"):
        if key in overlay:
            model_fields[key] = overlay[key]

    param_count_b: float = model_fields["param_count_b"]

    model = db.query(Model).filter(Model.model_key == repo_id).first()
    if model is None:
        model = Model(**model_fields)
        db.add(model)
        db.flush()
        logger.info("hf_seeder: created %s", repo_id)
    else:
        for k, v in model_fields.items():
            setattr(model, k, v)
        db.flush()
        logger.info("hf_seeder: updated %s", repo_id)

    # Replace all quants — delete then re-insert
    db.query(ModelQuant).filter(ModelQuant.model_id == model.id).delete(
        synchronize_session=False
    )
    db.flush()

    # Collect and deduplicate by name (quant_repos is downloads-sorted, first = best)
    quant_by_name: dict[str, dict[str, Any]] = {}
    for qr in _list_quants(api, repo_id, max_quants):
        for qdict in _build_quant_dicts(param_count_b, qr):
            name = qdict["name"]
            if name not in quant_by_name:
                quant_by_name[name] = qdict

    for qdict in quant_by_name.values():
        db.add(ModelQuant(model_id=model.id, **qdict))

    db.commit()
    db.refresh(model)

    # Derive recommended_engines from the actual quant data now that they're written
    model.recommended_engines = _derive_recommended_engines(model.quants, param_count_b)

    # Bridge: keep model_variants in sync so feasibility/selector queries don't return UNKNOWN
    for mq in model.quants:
        _upsert_model_variant(db, model, mq)

    db.commit()

    logger.info("hf_seeder: %s — %d quants written, %d variants synced, engines=%s",
                repo_id, len(model.quants), len(model.quants),
                [e["engine"] for e in model.recommended_engines])
    return model
