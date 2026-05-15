"""DB-backed platform settings with environment variable fallback."""

from __future__ import annotations

import logging
import json
import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.entities import Model, PlatformSetting

logger = logging.getLogger(__name__)

# Ordered tuple of all known setting keys.
KNOWN_KEYS: tuple[str, ...] = (
    "clore_api_key",
    "anthropic_api_key",
    "openai_api_key",
    "openai_model",
    "ssh_private_key",
    "hf_token",
    # Lab deployment behavior
    # recommend_only: show low-risk setup fixes but do not run them automatically.
    # auto_low_risk_setup: automatically run idempotent setup steps before launch.
    "lab_auto_setup_mode",
    # auto | docker | uv_venv. Auto prefers Docker only when Docker + NCT already work.
    "lab_default_runtime_mode",
    # JSON object keyed by deployment-plan step id. Used to override low-risk
    # preflight/setup command templates without changing application code.
    "lab_preflight_command_overrides",
    # Clore.ai global quality-bar filters — applied to all marketplace fetches.
    # All are optional; unset keys mean no filtering on that dimension.
    "clore_min_pcie_gen",
    "clore_min_pcie_width",
    "clore_min_disk_gb",
    "clore_min_dl_mbps",
    "clore_min_ul_mbps",
    "clore_min_cuda",
    "clore_min_vram_gb",
    "clore_gpu_query",
    "clore_max_price_per_day",
    # Models knowledge base
    "default_seed_models",       # newline-separated HF repo IDs to auto-seed on first run
    "excluded_quant_formats",    # comma/newline-separated quant formats to hide globally
    # Diagnostic publication
    "github_token",
    "github_repo",
    "github_publish_mode",
)

# Keys that, when saved or cleared, must invalidate the filtered offers cache.
CLORE_FILTER_KEYS: frozenset[str] = frozenset({
    "clore_min_pcie_gen",
    "clore_min_pcie_width",
    "clore_min_disk_gb",
    "clore_min_dl_mbps",
    "clore_min_ul_mbps",
    "clore_min_cuda",
    "clore_min_vram_gb",
    "clore_gpu_query",
    "clore_max_price_per_day",
})

# Environment variable names used as fallback when a key is absent from the DB.
_ENV_FALLBACKS: dict[str, str] = {
    "clore_api_key": "CLORE_API_KEY",
    "anthropic_api_key": "ANTHROPIC_API_KEY",
    "openai_api_key": "OPENAI_API_KEY",
    "openai_model": "OPENAI_MODEL",
    "hf_token": "HF_TOKEN",
    "github_token": "GITHUB_TOKEN",
    "github_repo": "GITHUB_REPO",
    "github_publish_mode": "GITHUB_PUBLISH_MODE",
}


def get_setting(key: str, db: Session) -> str | None:
    """Return the value for a setting key.

    Resolution order:
      1. ``platform_settings`` DB row (if non-empty)
      2. Corresponding environment variable (if set and non-empty)
      3. ``None`` — caller decides how to handle missing configuration
    """
    row = db.query(PlatformSetting).filter(PlatformSetting.key == key).first()
    if row and row.value:
        return row.value
    env_var = _ENV_FALLBACKS.get(key)
    if env_var:
        value = os.environ.get(env_var, "").strip()
        # Reject the placeholder injected by docker-compose defaults
        if value and value != "replace_me":
            return value
    return None


_BOOTSTRAP_SENTINEL_KEY = "_default_env_bootstrapped_at"

_DEFAULT_FILTER_ALIASES: dict[str, str] = {
    "pcie_gen": "clore_min_pcie_gen",
    "min_pcie_gen": "clore_min_pcie_gen",
    "clore_min_pcie_gen": "clore_min_pcie_gen",
    "pcie_width": "clore_min_pcie_width",
    "min_pcie_width": "clore_min_pcie_width",
    "clore_min_pcie_width": "clore_min_pcie_width",
    "disk": "clore_min_disk_gb",
    "disk_gb": "clore_min_disk_gb",
    "min_disk_gb": "clore_min_disk_gb",
    "clore_min_disk_gb": "clore_min_disk_gb",
    "download": "clore_min_dl_mbps",
    "download_mbps": "clore_min_dl_mbps",
    "dl_mbps": "clore_min_dl_mbps",
    "bandwidth_down": "clore_min_dl_mbps",
    "min_download_mbps": "clore_min_dl_mbps",
    "min_dl_mbps": "clore_min_dl_mbps",
    "clore_min_dl_mbps": "clore_min_dl_mbps",
    "upload": "clore_min_ul_mbps",
    "upload_mbps": "clore_min_ul_mbps",
    "ul_mbps": "clore_min_ul_mbps",
    "bandwidth_up": "clore_min_ul_mbps",
    "min_upload_mbps": "clore_min_ul_mbps",
    "min_ul_mbps": "clore_min_ul_mbps",
    "clore_min_ul_mbps": "clore_min_ul_mbps",
    "cuda": "clore_min_cuda",
    "min_cuda": "clore_min_cuda",
    "clore_min_cuda": "clore_min_cuda",
    "vram": "clore_min_vram_gb",
    "vram_gb": "clore_min_vram_gb",
    "min_vram_gb": "clore_min_vram_gb",
    "clore_min_vram_gb": "clore_min_vram_gb",
    "gpu": "clore_gpu_query",
    "gpu_query": "clore_gpu_query",
    "clore_gpu_query": "clore_gpu_query",
    "price": "clore_max_price_per_day",
    "max_price": "clore_max_price_per_day",
    "max_price_per_day": "clore_max_price_per_day",
    "clore_max_price_per_day": "clore_max_price_per_day",
}


def _parse_structured_defaults(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict):
        return parsed

    result: dict[str, str] = {}
    for token in raw.replace(";", ",").split(","):
        if not token.strip() or "=" not in token:
            continue
        key, value = token.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def _normalize_default_filter_value(key: str, value: Any) -> str | None:
    if value is None:
        return None
    if key == "clore_gpu_query":
        text = str(value).strip()
        return text or None
    if key == "clore_min_cuda":
        text = str(value).strip()
        return text or None

    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric < 0:
        return None
    if key in {"clore_min_dl_mbps", "clore_min_ul_mbps"}:
        numeric = min(numeric, 3000)
    if key == "clore_max_price_per_day":
        return str(round(numeric, 4))
    return str(int(numeric))


def _upsert_if_missing(db: Session, key: str, value: str) -> bool:
    existing = db.query(PlatformSetting).filter(PlatformSetting.key == key).first()
    if existing:
        return False
    db.add(PlatformSetting(key=key, value=value))
    return True


def bootstrap_defaults_from_env(db: Session) -> dict[str, object]:
    """Seed first-boot defaults from Docker env vars without overwriting users.

    The sentinel is intentionally internal, so these env vars behave as one-time
    bootstrapping inputs instead of runtime fallbacks.
    """
    if db.query(PlatformSetting).filter(PlatformSetting.key == _BOOTSTRAP_SENTINEL_KEY).first():
        return {"bootstrapped": False, "reason": "already_bootstrapped"}

    changed: list[str] = []
    raw_seed_models = os.environ.get("DEFAULT_SEED_MODELS", "").strip()
    if raw_seed_models:
        repos = [
            token.strip()
            for token in raw_seed_models.replace("\n", ",").split(",")
            if token.strip() and "/" in token.strip()
        ]
        if repos and _upsert_if_missing(db, "default_seed_models", "\n".join(repos)):
            changed.append("default_seed_models")

    raw_excluded = os.environ.get("DEFAULT_EXCLUDED_QUANT_FORMATS", "").strip()
    if raw_excluded:
        formats = sorted(
            {
                token.strip().lower()
                for token in raw_excluded.replace("\n", ",").split(",")
                if token.strip().lower() in _VALID_QUANT_FORMATS
            }
        )
        if formats and _upsert_if_missing(db, "excluded_quant_formats", ",".join(formats)):
            changed.append("excluded_quant_formats")

    raw_filters = os.environ.get("DEFAULT_GLOBAL_FILTERS", "").strip()
    if raw_filters:
        for raw_key, raw_value in _parse_structured_defaults(raw_filters).items():
            key = _DEFAULT_FILTER_ALIASES.get(str(raw_key).strip().lower())
            if not key:
                continue
            value = _normalize_default_filter_value(key, raw_value)
            if value and _upsert_if_missing(db, key, value):
                changed.append(key)

    db.add(PlatformSetting(key=_BOOTSTRAP_SENTINEL_KEY, value=datetime.now(timezone.utc).isoformat()))
    db.commit()

    queued: list[str] = []
    repos = get_default_seed_models(db)
    if repos:
        try:
            from app.workers.tasks import seed_model_from_hf

            existing = {row[0] for row in db.query(Model.model_key).filter(Model.model_key.in_(repos)).all()}
            for repo_id in repos:
                if repo_id in existing:
                    continue
                seed_model_from_hf.delay(repo_id)
                queued.append(repo_id)
        except Exception:
            logger.exception("Failed to queue DEFAULT_SEED_MODELS tasks")

    return {"bootstrapped": True, "settings": changed, "queued_seed_models": queued}


_VALID_QUANT_FORMATS: frozenset[str] = frozenset({
    "gguf", "awq", "gptq", "bnb", "fp8", "fp16", "int8", "int4", "fp4", "mlx", "unknown",
})


def get_default_seed_models(db: Session) -> list[str]:
    """Return the ordered list of HF repo IDs from the default_seed_models setting."""
    raw = get_setting("default_seed_models", db) or ""
    repos = []
    for line in raw.replace(",", "\n").splitlines():
        repo = line.strip()
        if repo and "/" in repo:
            repos.append(repo)
    return repos


def get_excluded_quant_formats(db: Session) -> set[str]:
    """Return the set of quant format keys to exclude globally from /models responses."""
    raw = get_setting("excluded_quant_formats", db) or ""
    result = set()
    for token in raw.replace(",", "\n").splitlines():
        fmt = token.strip().lower()
        if fmt in _VALID_QUANT_FORMATS:
            result.add(fmt)
    return result


def get_lab_auto_setup_mode(db: Session) -> str:
    """Return the Lab setup automation mode with a conservative default."""
    raw = (get_setting("lab_auto_setup_mode", db) or "recommend_only").strip().lower()
    if raw == "auto_low_risk_setup":
        return raw
    return "recommend_only"


def get_lab_default_runtime_mode(db: Session) -> str:
    """Return the default Lab runtime mode."""
    raw = (get_setting("lab_default_runtime_mode", db) or "auto").strip().lower()
    if raw in {"auto", "docker", "uv_venv"}:
        return raw
    return "auto"


CONFIGURABLE_LAB_COMMAND_IDS: frozenset[str] = frozenset({
    "host_snapshot",
    "disk_space",
    "docker_gpu",
    "apt_update",
    "ensure_curl",
    "install_uv",
    "create_venv",
})


def get_lab_preflight_command_overrides(db: Session) -> dict[str, dict[str, object]]:
    """Return sanitized per-step Lab command overrides.

    The setting is intentionally constrained to known preflight/setup step IDs.
    Unknown fields are ignored so future UI versions can add optional metadata
    without breaking older backends.
    """
    raw = get_setting("lab_preflight_command_overrides", db)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        logger.warning("Ignoring invalid lab_preflight_command_overrides JSON")
        return {}
    if not isinstance(parsed, dict):
        return {}

    result: dict[str, dict[str, object]] = {}
    for step_id, patch in parsed.items():
        if step_id not in CONFIGURABLE_LAB_COMMAND_IDS or not isinstance(patch, dict):
            continue

        cleaned: dict[str, object] = {}
        if "enabled" in patch:
            cleaned["enabled"] = bool(patch["enabled"])
        if "required" in patch:
            cleaned["required"] = bool(patch["required"])
        if "auto_eligible" in patch:
            cleaned["auto_eligible"] = bool(patch["auto_eligible"])
        if "recommended" in patch:
            cleaned["recommended"] = bool(patch["recommended"])
        command = patch.get("command")
        if isinstance(command, str):
            cleaned["command"] = command.strip()
        notes = patch.get("notes")
        if isinstance(notes, str):
            cleaned["notes"] = notes.strip()

        result[step_id] = cleaned
    return result


def upsert_setting(key: str, value: str, db: Session) -> PlatformSetting:
    """Insert or update a setting value and return the updated row."""
    row = db.query(PlatformSetting).filter(PlatformSetting.key == key).first()
    if row:
        row.value = value
        row.updated_at = datetime.now(timezone.utc)  # type: ignore[assignment]
    else:
        row = PlatformSetting(key=key, value=value)
        db.add(row)
    db.commit()
    db.refresh(row)
    return row
