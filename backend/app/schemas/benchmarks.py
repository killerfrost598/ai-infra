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


class InferenceBenchmarkListResponse(BaseModel):
    items: list[InferenceBenchmarkResponse]
    total: int
