import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.cache import get_redis_client
from app.db.session import get_db
from app.models.entities import Server, ServerStatus
from app.models.entities import Session as SessionEntity, SessionStatus
from app.schemas.servers import ServerResponse
from app.services.clore_client import CloreClient, CloreOffer
from app.services.clore_filters import apply_filters, load_clore_filters
from app.services.clore_grouping import group_offers
from app.services.settings_service import get_setting

# v2 cache keys — include parsed GPU fields and offer groups.
# Old keys (without :v2) are deleted on every write to prevent stale data.
_RAW_KEY = "clore:offers:raw:v2"
_FILTERED_KEY = "clore:offers:filtered:v2"
_GROUPS_KEY = "clore:offers:groups:v2"
_META_KEY = "clore:offers:meta:v2"
_OLD_KEYS = ["clore:offers:raw", "clore:offers:filtered", "clore:offers:meta"]
_CACHE_TTL = 600  # 10 minutes

router = APIRouter()

_SECRET_ENV_KEY_RE = re.compile(r"(token|secret|password|api[_-]?key|credential)", re.IGNORECASE)


def _redact_secret_env(env: dict[str, str] | None) -> dict[str, str] | None:
    if env is None:
        return None
    redacted: dict[str, str] = {}
    for key, value in env.items():
        redacted[key] = "***" if _SECRET_ENV_KEY_RE.search(key) else value
    return redacted


def _resolve_clore_key(db: Session) -> str:
    """Return the Clore API key or raise 503 if not configured."""
    key = get_setting("clore_api_key", db)
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Set your Clore API key in Settings to enable this action.",
        )
    return key


@router.get("/balance")
def get_balance(db: Session = Depends(get_db)) -> dict:
    """Return wallet balances for the authenticated Clore.ai account."""
    api_key = get_setting("clore_api_key", db)
    try:
        with CloreClient(api_key) as client:
            balance = client.get_balance()
        return balance.model_dump()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/offers")
def list_offers(
    refresh: bool = False,
    db: Session = Depends(get_db),
) -> dict:
    """Return the globally-filtered Clore.ai marketplace offer list.

    Results are cached in Redis for 10 minutes. Global quality-bar filters
    (PCIe gen/width, disk, network, CUDA, total VRAM) are read from
    ``platform_settings`` and applied before caching.

    Pass ``?refresh=true`` to bypass the cache and fetch live data immediately.
    """
    api_key = _resolve_clore_key(db)

    # Serve from filtered cache when not forcing a refresh
    if not refresh:
        try:
            r = get_redis_client()
            filtered_raw = r.get(_FILTERED_KEY)
            groups_raw = r.get(_GROUPS_KEY)
            meta_raw = r.get(_META_KEY)
            if filtered_raw and groups_raw and meta_raw:
                meta = json.loads(meta_raw)
                meta["from_cache"] = True
                meta["authenticated"] = bool(api_key)
                return {
                    "offers": json.loads(filtered_raw),
                    "groups": json.loads(groups_raw),
                    "meta": meta,
                }
        except Exception:
            pass

    # Attempt to reuse raw cache (avoids hitting the Clore SDK if only settings changed)
    raw_offers: list[CloreOffer] | None = None
    if not refresh:
        try:
            r = get_redis_client()
            raw_data = r.get(_RAW_KEY)
            if raw_data:
                raw_offers = [CloreOffer(**o) for o in json.loads(raw_data)]
        except Exception:
            pass

    # Fetch live from Clore SDK when cache is cold or refresh was requested
    if raw_offers is None:
        try:
            with CloreClient(api_key) as client:
                raw_offers = client.list_offers()
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        try:
            r = get_redis_client()
            r.setex(_RAW_KEY, _CACHE_TTL, json.dumps([o.model_dump() for o in raw_offers]))
        except Exception:
            pass

    # Apply global quality-bar filters
    clore_filters = load_clore_filters(db)
    filtered_offers, applied = apply_filters(raw_offers, clore_filters)

    # Build grouped representation for the UI grouped browse view
    groups = group_offers(filtered_offers)
    group_dicts = [g.model_dump() for g in groups]

    meta = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "total_raw": len(raw_offers),
        "total_filtered": len(filtered_offers),
        "applied_filters": applied,
        "from_cache": False,
        "authenticated": bool(api_key),
    }

    filtered_dicts = [o.model_dump() for o in filtered_offers]
    try:
        r = get_redis_client()
        # Nuke old-format keys before writing new ones
        r.delete(*_OLD_KEYS)
        r.setex(_FILTERED_KEY, _CACHE_TTL, json.dumps(filtered_dicts))
        r.setex(_GROUPS_KEY, _CACHE_TTL, json.dumps(group_dicts))
        r.setex(_META_KEY, _CACHE_TTL, json.dumps(meta))
    except Exception:
        pass

    return {"offers": filtered_dicts, "groups": group_dicts, "meta": meta}


@router.get("/rentals")
def list_rentals(db: Session = Depends(get_db)) -> dict:
    """List all active Clore.ai rentals and reconcile local server statuses.

    Any server in PROVISIONING or READY state whose Clore rental is no longer
    active will be marked TERMINATED, and its open sessions will be closed.
    This keeps the local DB in sync even when rentals are cancelled externally.
    """
    api_key = _resolve_clore_key(db)
    try:
        with CloreClient(api_key) as client:
            rentals = client.list_rentals()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    active_ids = {r.id for r in rentals}
    stale_servers = (
        db.query(Server)
        .filter(
            Server.status.in_([ServerStatus.PROVISIONING, ServerStatus.READY]),
            Server.external_server_id.isnot(None),
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    for server in stale_servers:
        ext_id = server.external_server_id
        if ext_id and not ext_id.startswith("manual-") and ext_id not in active_ids:
            server.status = ServerStatus.TERMINATED
            (
                db.query(SessionEntity)
                .filter(
                    SessionEntity.server_id == server.id,
                    SessionEntity.status == SessionStatus.ACTIVE,
                )
                .update({"status": SessionStatus.TERMINATED, "terminated_at": now})
            )
    db.commit()

    return {"rentals": [r.model_dump() for r in rentals]}


@router.get("/rentals/{rental_id}")
def get_rental(rental_id: str, db: Session = Depends(get_db)) -> dict:
    """Get details of a specific Clore.ai rental."""
    api_key = _resolve_clore_key(db)
    try:
        with CloreClient(api_key) as client:
            rental = client.get_rental(rental_id)
        return rental.model_dump()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class RentRequest(BaseModel):
    offer_id: str
    image: str = "cloreai/ubuntu22.04-cuda12"
    order_type: str = Field(default="on-demand", pattern="^(on-demand|spot)$")
    currency: str = "CLORE-Blockchain"
    ssh_password: str | None = None
    ssh_key: str | None = None
    ports: dict[str, str] | None = None
    env: dict[str, str] | None = None
    command: str | None = None
    jupyter_token: str | None = None
    spot_price: float | None = None
    required_price: float | None = None


@router.post("/rentals/dry-run")
def rent_server_dry_run(payload: RentRequest, db: Session = Depends(get_db)) -> dict:
    """Return the exact parameters that would be sent to Clore.ai without placing the order.

    Use this to verify your rent payload before committing. Does NOT charge your account.
    """
    _resolve_clore_key(db)  # Validate key is configured
    params: dict = {
        "server_id": int(payload.offer_id),
        "image": payload.image,
        "type": payload.order_type,
        "currency": payload.currency,
    }
    if payload.ssh_password:
        params["ssh_password"] = "***"
    if payload.ssh_key:
        params["ssh_key"] = f"{payload.ssh_key[:20]}…" if len(payload.ssh_key) > 20 else payload.ssh_key
    if payload.ports:
        params["ports"] = payload.ports
    if payload.env:
        params["env"] = _redact_secret_env(payload.env)
    if payload.command:
        params["command"] = payload.command
    if payload.jupyter_token:
        params["jupyter_token"] = "***"
    if payload.spot_price is not None and payload.order_type == "spot":
        params["spot_price"] = payload.spot_price
    if payload.required_price is not None:
        params["required_price"] = payload.required_price
    return {"would_send": params}


@router.post("/rentals", response_model=ServerResponse, status_code=201)
def rent_server(payload: RentRequest, db: Session = Depends(get_db)) -> Server:
    """Rent a server from Clore.ai and register it in the database.

    Supports all Clore.ai create_order parameters including SSH key auth,
    custom Docker images, port mappings, env vars, and spot pricing.
    The ssh_password, if provided, is stored on the Server record for SSH
    connectivity but is never returned by Clore rental list/detail responses.
    """
    if not payload.ssh_password and not payload.ssh_key:
        raise HTTPException(
            status_code=422,
            detail="Provide either ssh_password or ssh_key for server access.",
        )
    api_key = _resolve_clore_key(db)
    try:
        with CloreClient(api_key) as client:
            clore_server, returned_pw = client.rent_server(
                offer_id=payload.offer_id,
                image=payload.image,
                order_type=payload.order_type,
                currency=payload.currency,
                ssh_password=payload.ssh_password,
                ssh_key=payload.ssh_key,
                ports=payload.ports,
                env=payload.env,
                command=payload.command,
                jupyter_token=payload.jupyter_token,
                spot_price=payload.spot_price,
                required_price=payload.required_price,
            )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # When the user authenticated with an SSH key, retrieve the platform's stored
    # private key so terminal sessions can connect without a password.
    platform_private_key: str | None = None
    if payload.ssh_key:
        platform_private_key = get_setting("ssh_private_key", db)

    server = Server(
        external_server_id=clore_server.id,
        hostname=clore_server.hostname,
        ssh_port=clore_server.ssh_port,
        ssh_username=clore_server.ssh_username,
        ssh_password=returned_pw,
        ssh_private_key=platform_private_key,
        gpu_model=clore_server.gpu_name,
        vram_gb=clore_server.vram_gb,
        cuda_version=clore_server.cuda_version,
        status=ServerStatus.PROVISIONING,
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return server


@router.delete("/rentals/{rental_id}", status_code=204)
def terminate_rental(rental_id: str, db: Session = Depends(get_db)) -> None:
    """Terminate a Clore.ai rental and mark the server as terminated."""
    api_key = _resolve_clore_key(db)
    try:
        with CloreClient(api_key) as client:
            client.terminate_rental(rental_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    server = db.query(Server).filter(Server.external_server_id == rental_id).first()
    if server:
        server.status = ServerStatus.TERMINATED
        db.commit()
