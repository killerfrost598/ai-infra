"""DB-backed platform settings with environment variable fallback."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.entities import PlatformSetting

logger = logging.getLogger(__name__)

# Ordered tuple of all known setting keys.
KNOWN_KEYS: tuple[str, ...] = ("clore_api_key", "litellm_master_key")

# Environment variable names used as fallback when a key is absent from the DB.
_ENV_FALLBACKS: dict[str, str] = {
    "clore_api_key": "CLORE_API_KEY",
    "litellm_master_key": "LITELLM_MASTER_KEY",
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
