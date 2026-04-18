import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import ProviderAccount, Server, ServerStatus
from app.schemas.servers import ServerResponse
from app.services.clore_client import CloreClient, CloreOffer
from app.services.settings_service import get_setting

_OFFERS_CACHE_KEY = "clore:offers:all"
_OFFERS_TTL = 60  # seconds


def _get_redis():
    import redis as _redis
    return _redis.from_url("redis://redis:6379/2", decode_responses=True, socket_connect_timeout=2)

router = APIRouter()


@router.get("/debug-sdk")
def debug_sdk(db: Session = Depends(get_db)) -> dict:
    """Dump raw attributes of the first marketplace server from the SDK.

    Temporary endpoint — use this to verify field names and value types
    from the live clore-ai SDK before finalising the _sdk_to_offer mapping.
    Hit: GET /api/v1/clore/debug-sdk
    """
    api_key = _resolve_clore_key(db)
    try:
        from clore_ai import CloreAI  # type: ignore[import]
        sdk = CloreAI(api_key=api_key)
        servers = sdk.marketplace()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not servers:
        return {"count": 0, "message": "No servers returned by marketplace()"}

    s = servers[0]

    def _dump(obj: object, depth: int = 0) -> dict | str:
        if obj is None:
            return "None"
        if depth > 2:
            return f"<{type(obj).__name__}>"
        result: dict = {"__type__": type(obj).__name__}
        for attr in sorted(dir(obj)):
            if attr.startswith("_"):
                continue
            try:
                val = getattr(obj, attr)
                if callable(val):
                    continue
                if isinstance(val, (int, float, str, bool)) or val is None:
                    result[attr] = val
                elif isinstance(val, list):
                    result[attr] = [_dump(item, depth + 1) for item in val[:3]]
                else:
                    result[attr] = _dump(val, depth + 1)
            except Exception as exc:
                result[attr] = f"ERROR: {exc}"
        return result

    return {
        "total_servers": len(servers),
        "first_server": _dump(s),
    }


def _resolve_clore_key(db: Session) -> str:
    """Return the Clore API key or raise 503 if not configured."""
    key = get_setting("clore_api_key", db)
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Clore API key not configured — add it in Settings",
        )
    return key


@router.get("/balance")
def get_balance(db: Session = Depends(get_db)) -> dict:
    """Return wallet balances for the authenticated Clore.ai account."""
    api_key = _resolve_clore_key(db)
    try:
        with CloreClient(api_key) as client:
            balance = client.get_balance()
        return balance.model_dump()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/offers")
def list_offers(
    gpu_name: str | None = None,
    min_vram_gb: int | None = None,
    min_disk_gb: int | None = None,
    min_pcie_version: int | None = None,
    min_pcie_width: int | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """List available GPU marketplace offers from Clore.ai with optional server-side pre-filtering.

    Results are cached in Redis for 60 s so repeated page loads don't hit the Clore SDK.
    """
    api_key = _resolve_clore_key(db)

    offers: list[CloreOffer] | None = None

    # Try Redis cache first (full unfiltered list)
    try:
        r = _get_redis()
        cached = r.get(_OFFERS_CACHE_KEY)
        if cached:
            offers = [CloreOffer(**o) for o in json.loads(cached)]
    except Exception:
        pass  # Redis unavailable — fall through to live API

    if offers is None:
        try:
            with CloreClient(api_key) as client:
                offers = client.list_offers()
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        try:
            r = _get_redis()
            r.setex(_OFFERS_CACHE_KEY, _OFFERS_TTL, json.dumps([o.model_dump() for o in offers]))
        except Exception:
            pass  # Non-fatal if caching fails

    # Apply filters against the full list
    if gpu_name:
        offers = [o for o in offers if gpu_name.lower() in o.gpu_name.lower()]
    if min_vram_gb:
        offers = [o for o in offers if o.vram_gb >= min_vram_gb]
    if min_disk_gb:
        offers = [o for o in offers if (o.disk_gb or 0) >= min_disk_gb]
    if min_pcie_version:
        offers = [o for o in offers if o.pcie_version is not None and int(o.pcie_version) >= min_pcie_version]
    if min_pcie_width:
        offers = [o for o in offers if (o.pcie_width or 0) >= min_pcie_width]

    return {"offers": [o.model_dump() for o in offers]}


@router.get("/rentals")
def list_rentals(db: Session = Depends(get_db)) -> dict:
    """List all active Clore.ai rentals."""
    api_key = _resolve_clore_key(db)
    try:
        with CloreClient(api_key) as client:
            rentals = client.list_rentals()
        return {"rentals": [r.model_dump() for r in rentals]}
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
        params["env"] = payload.env
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
    The ssh_password (if provided or returned by the API) is stored on
    the Server record so terminal sessions can connect without re-entry.
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

    provider_account = db.query(ProviderAccount).filter(
        ProviderAccount.provider_name == "clore"
    ).first()
    if not provider_account:
        provider_account = ProviderAccount(provider_name="clore", account_label="Clore.ai")
        db.add(provider_account)
        db.commit()
        db.refresh(provider_account)

    # When the user authenticated with an SSH key, retrieve the platform's stored
    # private key so terminal sessions can connect without a password.
    platform_private_key: str | None = None
    if payload.ssh_key:
        platform_private_key = get_setting("ssh_private_key", db)

    server = Server(
        provider_account_id=provider_account.id,
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
