from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema
from app.schemas.deployment_plan import DeploymentPlanStep
from app.schemas.lab import RecommendRequest


class AgentRunRequest(RecommendRequest):
    runtime_mode: str = "auto"
    force: bool = False
    max_iterations: int = 3
    command_timeout_seconds: int = 120
    health_timeout_seconds: int = 300


class AgentRunStartResponse(BaseSchema):
    task_run_id: UUID
    model_run_id: UUID
    status: str
    tmux_session: str


class AgentRunEvent(BaseSchema):
    id: str
    ts: datetime
    type: str
    summary: str
    tool: str | None = None
    input: dict | None = None
    output: dict | None = None
    status: str = "ok"


class AgentRunStatusResponse(BaseSchema):
    task_run_id: UUID
    model_run_id: UUID | None = None
    status: str
    error_summary: str | None = None
    tmux_session: str | None = None
    cancel_requested: bool = False
    current_launch_command: str | None = None
    reasoning_summary: str | None = None
    health: dict = Field(default_factory=dict)
    success_ready: bool = False
    playbook_id: UUID | None = None
    tmux_output_tail: str = ""
    events: list[AgentRunEvent] = Field(default_factory=list)
    steps: list[DeploymentPlanStep] = Field(default_factory=list)


class AgentToolApprovalRequest(BaseSchema):
    tool_call_id: str
    approved: bool
    note: str | None = None


class AgentToolApprovalResponse(BaseSchema):
    task_run_id: UUID
    tool_call_id: str
    approved: bool


class PromotePlaybookResponse(BaseSchema):
    playbook_id: UUID
    git_repo: str
    git_commit: str | None = None
