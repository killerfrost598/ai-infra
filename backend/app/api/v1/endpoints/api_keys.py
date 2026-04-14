from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import ApiKey
from app.schemas.api_keys import ApiKeyCreate, ApiKeyListResponse, ApiKeyResponse

router = APIRouter()


@router.get("", response_model=ApiKeyListResponse)
def list_api_keys(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ApiKeyListResponse:
    total = db.query(ApiKey).count()
    items = db.query(ApiKey).offset(skip).limit(limit).all()
    return ApiKeyListResponse(items=items, total=total)


@router.post("", response_model=ApiKeyResponse, status_code=201)
def create_api_key(payload: ApiKeyCreate, db: Session = Depends(get_db)) -> ApiKey:
    api_key = ApiKey(**payload.model_dump())
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    return api_key


@router.get("/{key_id}", response_model=ApiKeyResponse)
def get_api_key(key_id: UUID, db: Session = Depends(get_db)) -> ApiKey:
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    return api_key


@router.delete("/{key_id}", status_code=204)
def revoke_api_key(key_id: UUID, db: Session = Depends(get_db)) -> None:
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    api_key.is_revoked = True
    db.commit()
