from datetime import datetime
from uuid import UUID

from app.schemas.base import BaseSchema, UUIDSchema


class ModelRunAttemptCreate(BaseSchema):
    server_id: UUID
    session_id: UUID | None = None
    model_id: UUID
    quant_id: UUID
    host_snapshot_id: UUID | None = None
    task_run_id: UUID | None = None
    engine: str
    engine_version: str | None = None
    mode: str = "container"
    container_image: str | None = None
    launch_command: str = ""
    launch_plan_json: dict | None = None
    feasibility_verdict: str = "UNKNOWN"
    forced: bool = False


class ModelRunAttemptUpdate(BaseSchema):
    status: str | None = None
    succeeded: bool | None = None
    failure_stage: str | None = None
    failure_message: str | None = None
    container_id: str | None = None
    ttft_ms: float | None = None
    tps_steady: float | None = None
    vram_used_gb: float | None = None
    health_check_url: str | None = None
    health_check_ok: bool | None = None
    operator_notes: str | None = None
    completed_at: datetime | None = None
    duration_seconds: int | None = None


class ModelRunAttemptResponse(UUIDSchema):
    server_id: UUID
    session_id: UUID | None
    model_id: UUID
    quant_id: UUID
    host_snapshot_id: UUID | None
    task_run_id: UUID | None
    engine: str
    engine_version: str | None
    mode: str
    container_image: str | None
    container_id: str | None
    launch_command: str
    launch_plan_json: dict | None
    feasibility_verdict: str
    forced: bool
    status: str
    succeeded: bool | None
    failure_stage: str | None
    failure_message: str | None
    ttft_ms: float | None
    tps_steady: float | None
    vram_used_gb: float | None
    health_check_url: str | None
    health_check_ok: bool | None
    operator_notes: str | None
    started_at: datetime
    completed_at: datetime | None
    duration_seconds: int | None
    published_url: str | None
    published_sha: str | None
    published_at: datetime | None
    updated_at: datetime


class ModelRunAggregate(BaseSchema):
    model_id: UUID
    quant_id: UUID
    total: int
    successful: int
    success_rate: float
    avg_tps: float | None


class ModelRunListResponse(BaseSchema):
    items: list[ModelRunAttemptResponse]
    total: int
