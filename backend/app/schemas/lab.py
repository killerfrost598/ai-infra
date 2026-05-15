from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema
from app.schemas.model_runs import ModelRunAttemptResponse


class FeasibilityCheckOut(BaseSchema):
    id: str
    status: str
    reason: str
    source: str


class FeasibilityReportOut(BaseSchema):
    verdict: str
    mode: str
    gpu_profile_key: str | None
    stack_matrix_id: int | None
    checks: list[FeasibilityCheckOut]


class ParallelPlanOut(BaseSchema):
    tp_size: int
    blocked: bool
    block_reason: str | None
    nvlink: bool
    interconnect_label: str


class InstallPlanOut(BaseSchema):
    stack_matrix_id: int
    mode: str
    container_image: str | None
    pip_index_url: str | None
    packages: list[str]
    launch_cmd: str
    tp_size: int
    gpu_memory_utilization: float
    env: dict[str, str]
    remote_port: int


class LaunchRecommendation(BaseSchema):
    requires_reprobe: bool = False
    feasibility: FeasibilityReportOut | None = None
    parallel: ParallelPlanOut | None = None
    install_plan: InstallPlanOut | None = None
    injectable_command: str = ""
    warnings: list[str] = Field(default_factory=list)
    force_required: bool = False


class RecommendRequest(BaseSchema):
    server_id: UUID
    model_id: UUID
    quant_id: UUID
    engine: str = "VLLM"
    session_id: UUID | None = None
    remote_port: int = 8000


class InjectRequest(BaseSchema):
    command: str
    dry_run: bool = False
    model_run_id: UUID | None = None


class InjectResponse(BaseSchema):
    injected: bool
    command: str


class ObserveRequest(BaseSchema):
    model_run_id: UUID | None = None
    container_id: str | None = None
    health_check_url: str | None = None


class ObserveResponse(BaseSchema):
    vram_used_gb: float | None = None
    gpu_utilization_pct: float | None = None
    health_ok: bool | None = None
    raw: dict = Field(default_factory=dict)


class ExecuteRecommendationRequest(RecommendRequest):
    force: bool = False
    command_timeout_seconds: int = 300
    health_timeout_seconds: int = 120


class ExecuteRecommendationResponse(BaseSchema):
    run: ModelRunAttemptResponse
    recommendation: LaunchRecommendation
    command_exit_code: int | None = None
    command_stdout: str = ""
    command_stderr: str = ""
    health_ok: bool | None = None
    vram_used_gb: float | None = None


class AiAssistRequest(RecommendRequest):
    provider: str = "auto"
    operator_goal: str = "Deploy this model with a robust, observable vLLM setup."
    include_prompt_context: bool = False


class AiAssistResponse(BaseSchema):
    provider: str
    model: str
    guidance: str
    prompt_context: dict | None = None


class LabKnownIssueMatch(BaseSchema):
    issue_id: str
    title: str
    diagnosis: str
    recommended_fix: str
    remediation: str | None = None
    safe_to_auto_apply: bool = False
    evidence: str = ""


class LabModelCacheOut(BaseSchema):
    id: UUID
    server_id: UUID
    model_id: UUID
    quant_id: UUID
    repo_id: str
    cache_path: str | None = None
    status: str
    total_bytes: int | None = None
    cached_bytes: int | None = None
    last_download_task_id: UUID | None = None
    last_checked_at: datetime | None = None
    error: str | None = None
    metadata_json: dict | None = None
    created_at: datetime
    updated_at: datetime


class LabActiveModelOut(BaseSchema):
    model_id: UUID | None = None
    quant_id: UUID | None = None
    repo_id: str | None = None
    port: int | None = None
    endpoint: str | None = None
    profile: dict | None = None
    health_ok: bool | None = None
    task_run_id: UUID | None = None
    model_run_id: UUID | None = None
    updated_at: datetime | None = None


class LabStateResponse(BaseSchema):
    server_id: UUID
    initialized: bool = False
    initialized_at: datetime | None = None
    vllm_installed: bool = False
    vllm_installed_at: datetime | None = None
    vllm_version: str | None = None
    vllm_help_flags: dict | None = None
    vllm_supported_flags: list[str] = Field(default_factory=list)
    downloaded_models: list[LabModelCacheOut] = Field(default_factory=list)
    active_model: LabActiveModelOut | None = None
    last_successful_profile: dict | None = None
    last_failed_profile: dict | None = None
    last_failure_kind: str | None = None
    last_failure_reason: str | None = None
    last_failure_diagnosis: list[LabKnownIssueMatch] = Field(default_factory=list)
    benchmarks: list[dict] = Field(default_factory=list)
    help_note: str
    updated_at: datetime | None = None


class LabChatMessage(BaseSchema):
    role: str
    content: str


class LabChatRequest(BaseSchema):
    session_id: UUID
    server_id: UUID
    model_id: UUID | None = None
    quant_id: UUID | None = None
    port: int | None = None
    messages: list[LabChatMessage]
    max_tokens: int = 128
    temperature: float = 0.2


class LabChatResponse(BaseSchema):
    ok: bool
    model: str | None = None
    content: str = ""
    raw: dict | None = None
    latency_ms: int
    usage: dict | None = None
    error: str | None = None


class LabBenchmarkActiveRequest(BaseSchema):
    session_id: UUID
    server_id: UUID
    profile: str = "quick"


class LabBenchmarkActiveResponse(BaseSchema):
    task_run_id: UUID
    status: str
