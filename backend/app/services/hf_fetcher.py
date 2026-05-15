"""HF API fetch helpers — Redis cache + HuggingFace Hub calls."""
from __future__ import annotations

import json
import os
from typing import Any

import httpx
from huggingface_hub import HfApi
from huggingface_hub.errors import HfHubHTTPError, RepositoryNotFoundError
from sqlalchemy.orm import Session

from app.core.cache import get_redis_client
from app.services.hf_constants import _MODEL_EXPAND, _QUANT_LIST_EXPAND
from app.services.settings_service import get_setting

_CACHE_TTL = 24 * 3600
_USER_AGENT = "inferix-seeder/0.2 (+local)"


# ── Redis cache ────────────────────────────────────────────────────────────────

def _cache_get(kind: str, key: str) -> Any | None:
    cache_key = f"hfseed:{kind}:{key.replace('/', '__')}"
    try:
        val = get_redis_client().get(cache_key)
        return json.loads(val) if val is not None else None
    except Exception:
        return None


def _cache_put(kind: str, key: str, value: Any) -> None:
    cache_key = f"hfseed:{kind}:{key.replace('/', '__')}"
    try:
        get_redis_client().setex(cache_key, _CACHE_TTL, json.dumps(value, default=str))
    except Exception:
        pass


# ── HF token + API ────────────────────────────────────────────────────────────

def _get_token(db: Session) -> str | None:
    token = get_setting("hf_token", db)
    if not token:
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    return token or None


def _make_api(token: str | None) -> HfApi:
    return HfApi(token=token, user_agent=_USER_AGENT)


# ── HF fetch helpers ──────────────────────────────────────────────────────────

def _fetch_model_info(api: HfApi, repo_id: str) -> dict[str, Any] | None:
    cached = _cache_get("modelinfo", repo_id)
    if cached is not None:
        return None if cached.get("_error") else cached

    try:
        info = api.model_info(repo_id, expand=_MODEL_EXPAND)
    except RepositoryNotFoundError:
        _cache_put("modelinfo", repo_id, {"_error": "not_found"})
        return None
    except HfHubHTTPError as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        _cache_put("modelinfo", repo_id, {"_error": f"http_{status}"})
        return None

    sib = [
        {"rfilename": getattr(s, "rfilename", None), "size": getattr(s, "size", None)}
        for s in (getattr(info, "siblings", None) or [])
    ]
    safe_raw = getattr(info, "safetensors", None)
    safe_d = (
        {"parameters": getattr(safe_raw, "parameters", None) or {}, "total": getattr(safe_raw, "total", None)}
        if safe_raw is not None else None
    )
    gguf_raw = getattr(info, "gguf", None)

    out: dict[str, Any] = {
        "id": info.id,
        "config": getattr(info, "config", None),
        "cardData": (info.card_data.to_dict() if getattr(info, "card_data", None) else None),
        "siblings": sib,
        "tags": list(getattr(info, "tags", []) or []),
        "safetensors": safe_d,
        "gguf": {"total": getattr(gguf_raw, "total", None)} if gguf_raw is not None else None,
        "gated": getattr(info, "gated", None),
        "downloads": getattr(info, "downloads", None),
        "likes": getattr(info, "likes", None),
        "library_name": getattr(info, "library_name", None),
        "pipeline_tag": getattr(info, "pipeline_tag", None),
        "lastModified": str(getattr(info, "last_modified", None)),
        "createdAt": str(getattr(info, "created_at", None)),
        "trendingScore": getattr(info, "trending_score", None),
    }
    _cache_put("modelinfo", repo_id, out)
    return out


def _fetch_config_json(repo_id: str, token: str | None) -> dict[str, Any] | None:
    cached = _cache_get("config", repo_id)
    if cached is not None:
        return None if cached.get("_missing") else cached

    headers = {"User-Agent": _USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"https://huggingface.co/{repo_id}/resolve/main/config.json"
    try:
        r = httpx.get(url, headers=headers, timeout=20, follow_redirects=True)
    except httpx.RequestError:
        _cache_put("config", repo_id, {"_missing": True})
        return None

    if r.status_code == 200:
        try:
            data = r.json()
            _cache_put("config", repo_id, data)
            return data
        except Exception:
            pass

    _cache_put("config", repo_id, {"_missing": True})
    return None


def _list_quants(api: HfApi, repo_id: str, max_quants: int | None) -> list[dict[str, Any]]:
    cached = _cache_get("quants", repo_id)
    if cached is not None:
        return cached if max_quants is None else cached[:max_quants]

    rows: list[dict[str, Any]] = []
    try:
        for m in api.list_models(
            filter=f"base_model:quantized:{repo_id}",
            sort="downloads",
            limit=max_quants or 1000,
            expand=_QUANT_LIST_EXPAND,
        ):
            sib = [
                {"rfilename": getattr(s, "rfilename", None), "size": getattr(s, "size", None)}
                for s in (getattr(m, "siblings", None) or [])
            ]
            safe_raw = getattr(m, "safetensors", None)
            safe_d = (
                {"parameters": getattr(safe_raw, "parameters", None) or {}, "total": getattr(safe_raw, "total", None)}
                if safe_raw is not None else None
            )
            gguf_raw = getattr(m, "gguf", None)
            rows.append({
                "id": m.id,
                "tags": list(getattr(m, "tags", []) or []),
                "downloads": getattr(m, "downloads", None),
                "likes": getattr(m, "likes", None),
                "library_name": getattr(m, "library_name", None),
                "pipeline_tag": getattr(m, "pipeline_tag", None),
                "gated": getattr(m, "gated", None),
                "siblings": sib,
                "safetensors": safe_d,
                "gguf": {"total": getattr(gguf_raw, "total", None)} if gguf_raw is not None else None,
            })
    except HfHubHTTPError:
        pass

    _cache_put("quants", repo_id, rows)
    return rows if max_quants is None else rows[:max_quants]
