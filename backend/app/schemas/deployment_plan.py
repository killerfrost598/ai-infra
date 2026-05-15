from __future__ import annotations

from datetime import datetime
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
    kind: str | None = None  # "structured_download" → executor skips, UI opens modal
    required: bool = True
    status: str = "PENDING"
    risk: str = "low"
    auto_eligible: bool = False
    recommended: bool = False
    expected: str | None = None
    notes: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    stdout_tail: str = ""
    stderr_tail: str = ""
    error: str | None = None


class DeploymentPlanResponse(BaseSchema):
    runtime_mode: str
    engine: str
    remote_port: int
    ready_to_run: bool
    blockers: list[str]
    steps: list[DeploymentPlanStep]
    recommendation: LaunchRecommendation


class DeploymentRunRequest(DeploymentPlanRequest):
    auto_setup_mode: str | None = None
    force: bool = False
    health_timeout_seconds: int = 180
    command_timeout_seconds: int = 1800


class DeploymentRunStartResponse(BaseSchema):
    task_run_id: UUID
    model_run_id: UUID
    status: str


class DeploymentRunStatusResponse(BaseSchema):
    task_run_id: UUID
    model_run_id: UUID | None = None
    status: str
    error_summary: str | None = None
    runtime_mode: str | None = None
    auto_setup_mode: str | None = None
    cancel_requested: bool = False
    steps: list[DeploymentPlanStep]


class PipelineStepRequest(BaseSchema):
    session_id: UUID
    server_id: UUID


class PipelineDownloadModelRequest(PipelineStepRequest):
    model_id: UUID
    quant_id: UUID


class PipelineModelFlags(BaseSchema):
    enable_tools: bool = False
    tool_call_parser: str | None = None
    enable_thinking: bool = False
    reasoning_parser: str | None = None
    max_model_len: int | None = None
    gpu_memory_utilization: float = 0.9
    dtype: str = "auto"
    tensor_parallel_size: int = 1
    enable_chunked_prefill: bool = False
    trust_remote_code: bool = False
    extra_flags: str = ""
    remote_port: int = 8000


class PipelineRunModelRequest(PipelineStepRequest):
    model_id: UUID
    quant_id: UUID
    flags: PipelineModelFlags = PipelineModelFlags()


class PipelineStartResponse(BaseSchema):
    task_run_id: UUID
    status: str
    download_id: str | None = None  # set only for the download-model step
    model_run_id: UUID | None = None  # set for the run-model step
