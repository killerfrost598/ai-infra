"""Pydantic schemas for the model-downloads API."""

from __future__ import annotations

from uuid import UUID

from app.schemas.base import BaseSchema


class ModelDownloadStartRequest(BaseSchema):
    server_id: UUID
    session_id: UUID
    model_id: UUID
    quant_id: UUID


class DownloadFile(BaseSchema):
    filename: str
    size: int
    size_mb: float
    status: str
    downloaded: int
    downloaded_mb: float
    percent: float
    error: str


class DownloadStartResponse(BaseSchema):
    download_id: str
    task_run_id: str
    repo_id: str
    files: list[DownloadFile]
    total_bytes: int
    cached_bytes: int


class DownloadSnapshot(BaseSchema):
    event_type: str
    download_id: str
    repo_id: str
    files: list[DownloadFile]
    file_index: int
    total_files: int
    downloaded: int
    downloaded_mb: float
    total: int
    total_mb: float
    percent: float
    avg_speed_mbps: float
    elapsed: float
    eta_seconds: float
    finished: bool
    error: str


class CancelResponse(BaseSchema):
    cancelled: bool
