"""Secret encryption helpers.

Values encrypted by this module are stored with a versioned prefix so existing
plaintext development data can still be read during migration.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

SECRET_PREFIX = "enc:v1:"

SECRET_SETTING_KEYS: frozenset[str] = frozenset({
    "clore_api_key",
    "hf_token",
    "anthropic_api_key",
    "openai_api_key",
    "ssh_private_key",
    "github_token",
})


def _fernet() -> Fernet | None:
    key = settings.inferix_secret_key.strip()
    if not key:
        return None
    return Fernet(key.encode("utf-8"))


def encrypt_secret(value: str | None) -> str | None:
    """Encrypt a secret if `INFERIX_SECRET_KEY` is configured."""
    if value is None or value.startswith(SECRET_PREFIX):
        return value
    fernet = _fernet()
    if fernet is None:
        return value
    token = fernet.encrypt(value.encode("utf-8")).decode("ascii")
    return f"{SECRET_PREFIX}{token}"


def decrypt_secret(value: str | None) -> str | None:
    """Decrypt a stored secret, returning legacy plaintext values unchanged."""
    if value is None or not value.startswith(SECRET_PREFIX):
        return value
    fernet = _fernet()
    if fernet is None:
        raise RuntimeError("INFERIX_SECRET_KEY is required to decrypt stored secrets")
    token = value[len(SECRET_PREFIX):].encode("ascii")
    try:
        return fernet.decrypt(token).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored secret could not be decrypted with INFERIX_SECRET_KEY") from exc


def encrypt_setting_value(key: str, value: str) -> str:
    if key in SECRET_SETTING_KEYS:
        return encrypt_secret(value) or ""
    return value


def decrypt_setting_value(key: str, value: str) -> str:
    if key in SECRET_SETTING_KEYS:
        return decrypt_secret(value) or ""
    return value
