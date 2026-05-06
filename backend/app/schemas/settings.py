from datetime import datetime

from app.schemas.base import BaseSchema


class SettingResponse(BaseSchema):
    key: str
    is_configured: bool
    updated_at: datetime | None = None
    value: str | None = None  # populated for non-secret keys only


class SettingUpsert(BaseSchema):
    value: str


class SettingsListResponse(BaseSchema):
    settings: list[SettingResponse]
