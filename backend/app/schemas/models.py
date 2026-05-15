from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseSchema, UUIDSchema


class ModelQuantCreate(BaseSchema):
    name: str
    hf_repo: str | None = None
    hf_url: str | None = None
    bits_per_weight: float
    disk_size_gb: float
    vram_weights_gb: float
    quality_score: float = Field(1.0, ge=0.0, le=1.0)
    cc_min: str | None = None
    arch_vllm: bool = True
    arch_sglang: bool = True
    notes: str | None = None
    quant_format: str = "unknown"
    quant_variant: str | None = None
    safetensors_dtypes: dict | None = None
    tags: list[str] = Field(default_factory=list)
    library_name: str | None = None
    gated: str | None = None
    hf_downloads: int | None = None
    hf_likes: int | None = None
    author: str | None = None
    author_class: str | None = None
    author_label: str | None = None
    author_url: str | None = None


class ModelQuantUpdate(BaseSchema):
    name: str | None = None
    hf_repo: str | None = None
    hf_url: str | None = None
    bits_per_weight: float | None = None
    disk_size_gb: float | None = None
    vram_weights_gb: float | None = None
    quality_score: float | None = Field(None, ge=0.0, le=1.0)
    cc_min: str | None = None
    arch_vllm: bool | None = None
    arch_sglang: bool | None = None
    notes: str | None = None
    quant_format: str | None = None
    quant_variant: str | None = None
    safetensors_dtypes: dict | None = None
    tags: list[str] | None = None
    library_name: str | None = None
    gated: str | None = None
    hf_downloads: int | None = None
    hf_likes: int | None = None
    author: str | None = None
    author_class: str | None = None
    author_label: str | None = None
    author_url: str | None = None


class ModelQuantResponse(UUIDSchema):
    model_id: UUID
    name: str
    hf_repo: str | None
    hf_url: str | None
    bits_per_weight: float
    disk_size_gb: float
    vram_weights_gb: float
    quality_score: float
    cc_min: str | None
    arch_vllm: bool
    arch_sglang: bool
    notes: str | None
    quant_format: str
    quant_variant: str | None
    safetensors_dtypes: dict | None
    tags: list[str]
    library_name: str | None
    gated: str | None
    hf_downloads: int | None
    hf_likes: int | None
    author: str | None
    author_class: str | None
    author_label: str | None
    author_url: str | None


class ModelCreate(BaseSchema):
    model_key: str
    name: str
    family: str
    param_count_b: float
    hf_url: str | None = None
    hf_repo: str | None = None
    max_context_k: int
    tags: list[str] = Field(default_factory=list)
    use_case: str = "chat"
    is_reasoning: bool = False
    supports_tools: bool = False
    is_code_model: bool = False
    is_moe: bool = False
    moe_active_params_b: float | None = None
    num_attention_heads: int | None = None
    tp_allowed_sizes: list[int] | None = None
    kv_cache: dict = Field(default_factory=dict)
    recommended_engines: list[dict] = Field(default_factory=list)
    recommended_flags: dict = Field(default_factory=dict)
    quants: list[ModelQuantCreate] = Field(default_factory=list)
    # Extended HF metadata
    org: str | None = None
    architecture: str | None = None
    pipeline_tag: str | None = None
    library_name: str | None = None
    license: str | None = None
    languages: list[str] | None = None
    gated: str | None = None
    base_model: str | None = None
    hf_downloads: int | None = None
    hf_likes: int | None = None
    hf_trending_score: float | None = None
    hf_last_modified: datetime | None = None
    hf_created_at: datetime | None = None
    author: str | None = None
    author_class: str | None = None
    author_label: str | None = None
    author_url: str | None = None


class ModelUpdate(BaseSchema):
    name: str | None = None
    family: str | None = None
    param_count_b: float | None = None
    hf_url: str | None = None
    hf_repo: str | None = None
    max_context_k: int | None = None
    tags: list[str] | None = None
    use_case: str | None = None
    is_reasoning: bool | None = None
    supports_tools: bool | None = None
    is_code_model: bool | None = None
    is_moe: bool | None = None
    moe_active_params_b: float | None = None
    num_attention_heads: int | None = None
    tp_allowed_sizes: list[int] | None = None
    kv_cache: dict | None = None
    recommended_engines: list[dict] | None = None
    recommended_flags: dict | None = None
    is_archived: bool | None = None
    org: str | None = None
    architecture: str | None = None
    pipeline_tag: str | None = None
    library_name: str | None = None
    license: str | None = None
    languages: list[str] | None = None
    gated: str | None = None
    base_model: str | None = None
    hf_downloads: int | None = None
    hf_likes: int | None = None
    hf_trending_score: float | None = None
    hf_last_modified: datetime | None = None
    hf_created_at: datetime | None = None
    author: str | None = None
    author_class: str | None = None
    author_label: str | None = None
    author_url: str | None = None


class ModelResponse(UUIDSchema):
    model_key: str
    name: str
    family: str
    param_count_b: float
    hf_url: str | None
    hf_repo: str | None
    max_context_k: int
    tags: list[str]
    use_case: str
    is_reasoning: bool
    supports_tools: bool
    is_code_model: bool
    is_moe: bool
    moe_active_params_b: float | None
    num_attention_heads: int | None
    tp_allowed_sizes: list[int] | None
    kv_cache: dict
    recommended_engines: list[dict]
    recommended_flags: dict
    source: str
    hf_synced_at: datetime | None
    is_archived: bool
    updated_at: datetime
    quants: list[ModelQuantResponse] = Field(default_factory=list)
    # Extended HF metadata
    org: str | None
    architecture: str | None
    pipeline_tag: str | None
    library_name: str | None
    license: str | None
    languages: list[str] | None
    gated: str | None
    base_model: str | None
    hf_downloads: int | None
    hf_likes: int | None
    hf_trending_score: float | None
    hf_last_modified: datetime | None
    hf_created_at: datetime | None
    author: str | None
    author_class: str | None
    author_label: str | None
    author_url: str | None


# ── HF seeder schemas ─────────────────────────────────────────────────────────

class SeedRequest(BaseSchema):
    repo_id: str


class SeedResponse(BaseSchema):
    celery_task_id: str
    repo_id: str


class SyncStatus(BaseSchema):
    task_type: str | None
    status: str | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_seconds: int | None
    error_summary: str | None
    metadata: dict | None
