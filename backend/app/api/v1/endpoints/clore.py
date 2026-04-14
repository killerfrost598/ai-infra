from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import ProviderAccount, Server, ServerStatus
from app.schemas.servers import ServerResponse
from app.services.clore_client import CloreClient
from app.services.settings_service import get_setting

router = APIRouter()


def _resolve_clore_key(db: Session) -> str:
    """Return the Clore API key or raise 503 if not configured."""
    key = get_setting("clore_api_key", db)
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Clore API key not configured — add it in Settings",
        )
    return key


@router.get("/offers")
def list_offers(
    gpu_name: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """List available GPU marketplace offers from Clore.ai."""
    api_key = _resolve_clore_key(db)
    try:
        with CloreClient(api_key) as client:
            offers = client.list_offers(gpu_name=gpu_name)
        return {"offers": [o.model_dump() for o in offers]}
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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


@router.post("/rentals", response_model=ServerResponse, status_code=201)
def rent_server(
    offer_id: str,
    image: str = "cloreai/ubuntu22.04-cuda12",
    ssh_password: str | None = None,
    db: Session = Depends(get_db),
) -> Server:
    """Rent a server from Clore.ai and register it in the database."""
    api_key = _resolve_clore_key(db)
    try:
        with CloreClient(api_key) as client:
            clore_server = client.rent_server(
                offer_id=offer_id,
                image=image,
                ssh_password=ssh_password,
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

    server = Server(
        provider_account_id=provider_account.id,
        external_server_id=clore_server.id,
        hostname=clore_server.hostname,
        ssh_port=clore_server.ssh_port,
        ssh_username=clore_server.ssh_username,
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
