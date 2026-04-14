from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import ProviderAccount
from app.schemas.provider_accounts import (
    ProviderAccountCreate,
    ProviderAccountListResponse,
    ProviderAccountResponse,
    ProviderAccountUpdate,
)

router = APIRouter()


@router.get("", response_model=ProviderAccountListResponse)
def list_provider_accounts(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ProviderAccountListResponse:
    total = db.query(ProviderAccount).count()
    items = db.query(ProviderAccount).offset(skip).limit(limit).all()
    return ProviderAccountListResponse(items=items, total=total)


@router.post("", response_model=ProviderAccountResponse, status_code=201)
def create_provider_account(payload: ProviderAccountCreate, db: Session = Depends(get_db)) -> ProviderAccount:
    account = ProviderAccount(**payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.get("/{account_id}", response_model=ProviderAccountResponse)
def get_provider_account(account_id: UUID, db: Session = Depends(get_db)) -> ProviderAccount:
    account = db.query(ProviderAccount).filter(ProviderAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Provider account not found")
    return account


@router.patch("/{account_id}", response_model=ProviderAccountResponse)
def update_provider_account(
    account_id: UUID,
    payload: ProviderAccountUpdate,
    db: Session = Depends(get_db),
) -> ProviderAccount:
    account = db.query(ProviderAccount).filter(ProviderAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Provider account not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, key, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=204)
def delete_provider_account(account_id: UUID, db: Session = Depends(get_db)) -> None:
    account = db.query(ProviderAccount).filter(ProviderAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Provider account not found")
    db.delete(account)
    db.commit()
