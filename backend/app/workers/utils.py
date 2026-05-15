"""Shared helpers used by both tasks.py and benchmark_tasks.py.

Kept in a separate module to avoid the circular import:
  tasks → celery_app → benchmark_tasks → tasks
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import IO

from app.core.config import settings
from app.models.entities import TaskRun

LOG_DIR = settings.logs_base_path


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


def _log_path(task_run_id: str) -> str:
    os.makedirs(LOG_DIR, exist_ok=True)
    return os.path.join(LOG_DIR, f"{task_run_id}.log")


def _make_logger(log_f: IO[str]):
    def _log(text: str) -> None:
        log_f.write(text)
        log_f.flush()
    return _log


def _finish_task_run(task_run: TaskRun, db) -> None:
    task_run.finished_at = _utcnow()
    if task_run.started_at:
        delta = task_run.finished_at - task_run.started_at
        task_run.duration_seconds = int(delta.total_seconds())
    db.commit()
