from uuid import UUID

from app.schemas.base import BaseSchema, UUIDSchema


class ProviderAccountCreate(BaseSchema):
    provider_name: str
    account_label: str
    metadata_json: dict | None = None


class ProviderAccountUpdate(BaseSchema):
    account_label: str | None = None
    metadata_json: dict | None = None
    is_active: bool | None = None


class ProviderAccountResponse(UUIDSchema):
    provider_name: str
    account_label: str
    metadata_json: dict | None
    is_active: bool


class ProviderAccountListResponse(BaseSchema):
    items: list[ProviderAccountResponse]
    total: int
