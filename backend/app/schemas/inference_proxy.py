from datetime import datetime
from uuid import UUID

from app.schemas.base import BaseSchema


class InferenceProxyRouteResponse(BaseSchema):
    id: UUID
    route_slug: str
    server_id: UUID
    session_id: UUID | None = None
    model_id: UUID | None = None
    quant_id: UUID | None = None
    model_run_id: UUID | None = None
    model_name: str
    target_base_url: str
    proxy_base_url: str
    remote_port: int
    profile_json: dict | None = None
    status: str
    hourly_cost_usd: float | None = None
    last_seen_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class InferenceProxyRoutesResponse(BaseSchema):
    routes: list[InferenceProxyRouteResponse]


class InferenceProxyMetricSummary(BaseSchema):
    requests_last_minute: int = 0
    requests_24h: int = 0
    input_tokens_24h: int = 0
    output_tokens_24h: int = 0
    total_tokens_24h: int = 0
    avg_latency_ms_24h: float | None = None
    avg_ttft_ms_24h: float | None = None
    avg_tokens_per_second_24h: float | None = None
    estimated_cost_usd_24h: float | None = None
    effectiveness_score_24h: float | None = None
    by_category_24h: dict[str, int]


class InferenceProxyMetricResponse(BaseSchema):
    summary: InferenceProxyMetricSummary
    active_routes: int
