from __future__ import annotations

from uuid import UUID

from app.schemas.base import BaseSchema
from app.schemas.lab import LaunchRecommendation


class DeploymentPlanRequest(BaseSchema):
    server_id: UUID
    model_id: UUID
    quant_id: UUID
    session_id: UUID | None = None
    engine: str = "VLLM"
    remote_port: int = 8000
    runtime_mode: str = "auto"


class DeploymentPlanStep(BaseSchema):
    id: str
    title: str
    stage: str
    command: str | None = None
    required: bool = True
    expected: str | None = None
    notes: str | None = None


class DeploymentPlanResponse(BaseSchema):
    runtime_mode: str
    engine: str
    remote_port: int
    ready_to_run: bool
    blockers: list[str]
    steps: list[DeploymentPlanStep]
    recommendation: LaunchRecommendation
