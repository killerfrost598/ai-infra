from datetime import datetime
from uuid import UUID

from app.models.entities import DeploymentStatus, EngineKind
from app.schemas.base import BaseSchema, UUIDSchema


class ModelDeploymentCreate(BaseSchema):
    server_id: UUID
    playbook_id: UUID | None = None
    model_name: str
    model_alias: str | None = None
    quantization: str | None = None
    tunnel_local_port: int | None = None
    remote_port: int = 8000
    engine: EngineKind = EngineKind.VLLM
    model_variant_id: UUID | None = None
    tp_size: int = 1


class ModelDeploymentUpdate(BaseSchema):
    status: DeploymentStatus | None = None
    tunnel_local_port: int | None = None
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
    status: DeploymentStatus
    started_at: datetime | None
    ended_at: datetime | None
    engine: EngineKind | None
    model_variant_id: UUID | None
    stack_matrix_id: int | None
    inference_base_url: str | None


class ModelDeploymentListResponse(BaseSchema):
    items: list[ModelDeploymentResponse]
    total: int
