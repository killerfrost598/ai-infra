import uuid

from app.schemas.base import BaseSchema, UUIDSchema


class PlaybookCreate(BaseSchema):
    name: str
    git_repo: str
    git_branch: str = "main"
    git_commit: str | None = None
    tags: dict | None = None
    requirements_json: dict | None = None


class PlaybookUpdate(BaseSchema):
    name: str | None = None
    git_branch: str | None = None
    git_commit: str | None = None
    tags: dict | None = None
    requirements_json: dict | None = None


class PlaybookResponse(UUIDSchema):
    name: str
    git_repo: str
    git_branch: str
    git_commit: str | None
    tags: dict | None
    requirements_json: dict | None
    model_variant_id: uuid.UUID | None = None
    engine: str | None = None
    source_session_id: uuid.UUID | None = None


class PlaybookListResponse(BaseSchema):
    items: list[PlaybookResponse]
    total: int


class RecommendedPlaybook(BaseSchema):
    playbook_id: uuid.UUID
    playbook_name: str
    engine: str | None
    total_runs: int
    successful_runs: int
    success_rate: float
