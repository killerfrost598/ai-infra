from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import PlatformSetting
from app.schemas.settings import SettingResponse, SettingUpsert, SettingsListResponse
from app.services.settings_service import KNOWN_KEYS, get_setting, upsert_setting

router = APIRouter()


@router.get("", response_model=SettingsListResponse)
def list_settings(db: Session = Depends(get_db)) -> SettingsListResponse:
    """Return all known setting keys with configured status.

    Values are never returned — only a boolean flag indicating whether
    a non-empty value exists (DB row or environment variable fallback).
    """
    rows: dict[str, PlatformSetting] = {
        row.key: row
        for row in db.query(PlatformSetting).filter(
            PlatformSetting.key.in_(KNOWN_KEYS)
        ).all()
    }
    settings = []
    for key in KNOWN_KEYS:
        row = rows.get(key)
        value = get_setting(key, db)
        settings.append(
            SettingResponse(
                key=key,
                is_configured=bool(value),
                updated_at=row.updated_at if row else None,
            )
        )
    return SettingsListResponse(settings=settings)


@router.put("/{key}", response_model=SettingResponse)
def set_setting(
    key: str,
    payload: SettingUpsert,
    db: Session = Depends(get_db),
) -> SettingResponse:
    """Upsert a setting value."""
    if key not in KNOWN_KEYS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown setting key: {key!r}. Valid keys: {list(KNOWN_KEYS)}",
        )
    if not payload.value.strip():
        raise HTTPException(status_code=422, detail="Value cannot be empty")
    row = upsert_setting(key, payload.value.strip(), db)
    return SettingResponse(key=row.key, is_configured=True, updated_at=row.updated_at)


@router.post("/generate-ssh-keypair")
def generate_ssh_keypair(db: Session = Depends(get_db)) -> dict:
    """Generate an Ed25519 SSH keypair.

    Stores the private key in platform_settings['ssh_private_key'] and returns
    the OpenSSH public key. Use the public key in Clore.ai rent requests so the
    platform's stored private key can authenticate terminal sessions.
    """
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives import serialization as _ser

        private_key = Ed25519PrivateKey.generate()

        private_pem = private_key.private_bytes(
            encoding=_ser.Encoding.PEM,
            format=_ser.PrivateFormat.OpenSSH,
            encryption_algorithm=_ser.NoEncryption(),
        ).decode()

        public_key = private_key.public_key().public_bytes(
            encoding=_ser.Encoding.OpenSSH,
            format=_ser.PublicFormat.OpenSSH,
        ).decode().strip()

        upsert_setting("ssh_private_key", private_pem, db)

        return {"public_key": public_key}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Key generation failed: {exc}") from exc


@router.get("/ssh-private-key")
def get_ssh_private_key(db: Session = Depends(get_db)) -> dict:
    """Return the stored SSH private key from platform settings."""
    key = get_setting("ssh_private_key", db)
    if not key:
        raise HTTPException(status_code=404, detail="No SSH private key found. Generate one first.")
    return {"private_key": key}


@router.delete("/{key}", status_code=204)
def delete_setting(key: str, db: Session = Depends(get_db)) -> None:
    """Delete a setting from the DB (env var fallback still applies after deletion)."""
    if key not in KNOWN_KEYS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown setting key: {key!r}. Valid keys: {list(KNOWN_KEYS)}",
        )
    row = db.query(PlatformSetting).filter(PlatformSetting.key == key).first()
    if row:
        db.delete(row)
        db.commit()
