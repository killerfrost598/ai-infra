from datetime import datetime
from uuid import UUID

from app.schemas.base import BaseSchema, UUIDSchema


class SessionCommandResponse(BaseSchema):
    id: UUID
    session_id: UUID
    sequence_num: int
    command: str
    stdout: str
    stderr: str
    exit_code: int | None
    executed_at: datetime
    duration_ms: int | None
    created_at: datetime


class SessionListItem(BaseSchema):
    id: UUID
    server_id: UUID
    server_hostname: str | None
    label: str | None
    status: str
    started_at: datetime
    terminated_at: datetime | None
    created_at: datetime
    command_count: int


class SessionResponse(UUIDSchema):
    server_id: UUID
    label: str | None
    status: str
    started_at: datetime
    terminated_at: datetime | None
    pty_log: str | None = None
    commands: list[SessionCommandResponse]


class SessionCreate(BaseSchema):
    server_id: UUID
    label: str | None = None


class CommandRequest(BaseSchema):
    command: str
    timeout: int = 30  # seconds; max enforced in endpoint


class SessionListResponse(BaseSchema):
    items: list[SessionListItem]
    total: int
