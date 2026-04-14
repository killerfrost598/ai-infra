from datetime import datetime
from uuid import UUID

from app.models.entities import TaskStatus
from app.schemas.base import BaseSchema, UUIDSchema


class TaskRunCreate(BaseSchema):
    task_type: str
    server_id: UUID | None = None
    model_deployment_id: UUID | None = None
    metadata_json: dict | None = None


class TaskRunUpdate(BaseSchema):
    status: TaskStatus | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_seconds: int | None = None
    logs_path: str | None = None
    error_summary: str | None = None


class TaskRunResponse(UUIDSchema):
    task_type: str
    status: TaskStatus
    server_id: UUID | None
    model_deployment_id: UUID | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_seconds: int | None
    logs_path: str | None
    error_summary: str | None
    metadata_json: dict | None


class TaskRunListResponse(BaseSchema):
    items: list[TaskRunResponse]
    total: int
