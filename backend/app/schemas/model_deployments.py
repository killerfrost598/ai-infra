from datetime import datetime
from uuid import UUID

from app.models.entities import DeploymentStatus
from app.schemas.base import BaseSchema, UUIDSchema


class ModelDeploymentCreate(BaseSchema):
    server_id: UUID
    playbook_id: UUID | None = None
    model_name: str
    model_alias: str | None = None
    quantization: str | None = None
    tunnel_local_port: int | None = None
    remote_port: int = 8000
    litellm_route_name: str | None = None


class ModelDeploymentUpdate(BaseSchema):
    status: DeploymentStatus | None = None
    tunnel_local_port: int | None = None
    litellm_route_name: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


class ModelDeploymentResponse(UUIDSchema):
    server_id: UUID
    playbook_id: UUID | None
    model_name: str
    model_alias: str | None
    quantization: str | None
    tunnel_local_port: int | None
    remote_port: int
    litellm_route_name: str | None
    status: DeploymentStatus
    started_at: datetime | None
    ended_at: datetime | None


class ModelDeploymentListResponse(BaseSchema):
    items: list[ModelDeploymentResponse]
    total: int
