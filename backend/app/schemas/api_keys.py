from app.schemas.base import BaseSchema, UUIDSchema


class ApiKeyCreate(BaseSchema):
    key_name: str
    key_prefix: str
    provider_name: str | None = None


class ApiKeyResponse(UUIDSchema):
    key_name: str
    key_prefix: str
    provider_name: str | None
    is_revoked: bool


class ApiKeyListResponse(BaseSchema):
    items: list[ApiKeyResponse]
    total: int
