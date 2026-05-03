from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class InferenceBenchmarkCreate(BaseModel):
    gpu_model: str
    gpu_vram_gb: int | None = None
    model_name: str
    model_family: str | None = None
    quantization: str | None = None
    tokens_per_second_avg: float | None = None
    tokens_per_second_p95: float | None = None
    max_parallel_connections: int | None = None
    vram_used_gb: float | None = None
    measured_at: str | None = None
    notes: str | None = None
    ttft_ms_p50: float | None = None
    ttft_ms_p95: float | None = None
    prefill_tokens_per_second: float | None = None
    cold_start_seconds: int | None = None
    concurrency_curve: list | None = None
    knee_concurrency: int | None = None
    profile: str | None = None
    deployment_id: str | None = None
    task_run_id: str | None = None
    model_variant_id: str | None = None


class InferenceBenchmarkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    gpu_model: str
    gpu_vram_gb: int | None
    model_name: str
    model_family: str | None
    quantization: str | None
    tokens_per_second_avg: float | None
    tokens_per_second_p95: float | None
    max_parallel_connections: int | None
    vram_used_gb: float | None
    measured_at: str | None
    notes: str | None
    created_at: str
    ttft_ms_p50: float | None = None
    ttft_ms_p95: float | None = None
    prefill_tokens_per_second: float | None = None
    cold_start_seconds: int | None = None
    concurrency_curve: list | None = None
    knee_concurrency: int | None = None
    profile: str | None = None
    deployment_id: str | None = None
    task_run_id: str | None = None
    model_variant_id: str | None = None


class InferenceBenchmarkListResponse(BaseModel):
    items: list[InferenceBenchmarkResponse]
    total: int
