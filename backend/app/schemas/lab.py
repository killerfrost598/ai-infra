from uuid import UUID

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
    warnings: list[str] = []
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
    raw: dict = {}


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
