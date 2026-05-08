"""Curated model overlay — merges hand-curated data with HF-seeded rows.

The overlay lives in a public GitHub repo (inferix-models) as a JSON file:
    {model_key: {chat_template, recommended_flags, engine_overrides,
                 broken_combinations, base_model_chain, notes, quality_overrides}}

Fetch is cached in Redis for 1 hour. When the repo doesn't exist yet (or the
fetch fails), apply_overlay() returns {} — no data is changed. Wire-in is
already present in seed_one_repo(); populate the repo to activate.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.core.cache import get_redis_client

logger = logging.getLogger(__name__)

_OVERLAY_URL = "https://raw.githubusercontent.com/inferix-ai/inferix-models/main/curation.json"
_CACHE_KEY = "curation:overlay:v1"
_CACHE_TTL = 3600  # 1 hour


def _fetch_overlay() -> dict[str, Any]:
    """Fetch the full curation JSON from GitHub. Returns {} on any error."""
    try:
        r = httpx.get(_OVERLAY_URL, timeout=10, follow_redirects=True)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return {}


def _load_overlay() -> dict[str, Any]:
    """Return the cached overlay, fetching from GitHub on a cache miss."""
    try:
        raw = get_redis_client().get(_CACHE_KEY)
        if raw:
            return json.loads(raw)
    except Exception:
        pass

    data = _fetch_overlay()

    try:
        get_redis_client().setex(_CACHE_KEY, _CACHE_TTL, json.dumps(data))
    except Exception:
        pass

    return data


def apply_overlay(model_key: str) -> dict[str, Any]:
    """Return the curated overrides for model_key, or {} if none exist."""
    try:
        overlay = _load_overlay()
        return overlay.get(model_key) or {}
    except Exception as exc:
        logger.debug("model_curation: overlay lookup failed for %s: %s", model_key, exc)
        return {}
