"""Persistence helpers for the Lab deployment pipeline."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.entities import (
    InferenceBenchmark,
    LabModelCache,
    LabServerState,
    Model,
    ModelQuant,
    TaskRun,
    TaskStatus,
)
from app.schemas.lab import LabActiveModelOut, LabKnownIssueMatch, LabModelCacheOut, LabStateResponse
from app.services.lab_vllm import LAB_VLLM_HELP_NOTE, classify_vllm_failure, parse_vllm_help_flags


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_or_create_lab_state(db: Session, server_id: UUID) -> LabServerState:
    state = db.query(LabServerState).filter(LabServerState.server_id == server_id).first()
    if state:
        return state
    state = LabServerState(server_id=server_id)
    db.add(state)
    db.flush()
    return state


def mark_server_initialized(db: Session, server_id: UUID) -> LabServerState:
    state = get_or_create_lab_state(db, server_id)
    state.initialized_at = state.initialized_at or utcnow()
    db.commit()
    db.refresh(state)
    return state


def mark_vllm_installed(
    db: Session,
    server_id: UUID,
    *,
    version: str | None = None,
    help_text: str | None = None,
) -> LabServerState:
    state = get_or_create_lab_state(db, server_id)
    state.vllm_installed_at = utcnow()
    if version:
        state.vllm_version = version.strip()
    if help_text:
        state.vllm_help_flags = parse_vllm_help_flags(help_text)
    db.commit()
    db.refresh(state)
    return state


def upsert_model_cache(
    db: Session,
    *,
    server_id: UUID,
    model_id: UUID,
    quant_id: UUID,
    repo_id: str,
    status: str,
    task_run_id: UUID | None = None,
    total_bytes: int | None = None,
    cached_bytes: int | None = None,
    error: str | None = None,
    metadata: dict | None = None,
) -> LabModelCache:
    row = (
        db.query(LabModelCache)
        .filter(
            LabModelCache.server_id == server_id,
            LabModelCache.model_id == model_id,
            LabModelCache.quant_id == quant_id,
            LabModelCache.repo_id == repo_id,
        )
        .first()
    )
    if not row:
        row = LabModelCache(
            server_id=server_id,
            model_id=model_id,
            quant_id=quant_id,
            repo_id=repo_id,
        )
        db.add(row)
    row.status = status
    row.last_checked_at = utcnow()
    row.error = error
    if task_run_id:
        row.last_download_task_id = task_run_id
    if total_bytes is not None:
        row.total_bytes = total_bytes
    if cached_bytes is not None:
        row.cached_bytes = cached_bytes
    if metadata is not None:
        row.metadata_json = metadata
    db.commit()
    db.refresh(row)
    return row


def mark_active_model(
    db: Session,
    *,
    server_id: UUID,
    model_id: UUID,
    quant_id: UUID,
    repo_id: str,
    port: int,
    profile: dict,
    task_run_id: UUID | None = None,
    model_run_id: UUID | None = None,
    health_ok: bool | None = True,
) -> LabServerState:
    state = get_or_create_lab_state(db, server_id)
    endpoint = f"http://127.0.0.1:{int(port)}/v1"
    state.active_model_id = model_id
    state.active_quant_id = quant_id
    state.active_model_repo = repo_id
    state.active_port = int(port)
    state.active_endpoint = endpoint
    state.active_profile_json = profile
    state.active_health_ok = health_ok
    state.active_task_run_id = task_run_id
    state.active_model_run_id = model_run_id
    state.active_updated_at = utcnow()
    state.last_successful_profile_json = profile
    state.last_failure_kind = None
    state.last_failure_reason = None
    state.last_failure_diagnosis_json = None
    db.commit()
    db.refresh(state)
    return state


def clear_active_model(db: Session, server_id: UUID) -> LabServerState:
    state = get_or_create_lab_state(db, server_id)
    state.active_health_ok = False
    state.active_updated_at = utcnow()
    db.commit()
    db.refresh(state)
    return state


def mark_launch_failure(
    db: Session,
    *,
    server_id: UUID,
    profile: dict | None,
    log_text: str,
    reason: str | None = None,
) -> LabServerState:
    matches = classify_vllm_failure(log_text or reason or "")
    state = get_or_create_lab_state(db, server_id)
    state.active_health_ok = False
    state.last_failed_profile_json = profile
    state.last_failure_kind = matches[0]["issue_id"] if matches else "unknown"
    state.last_failure_reason = (reason or log_text or "vLLM launch failed")[:4000]
    state.last_failure_diagnosis_json = matches
    db.commit()
    db.refresh(state)
    return state


def _exec(client, command: str, timeout: int = 20) -> tuple[str, str, int]:
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    stdin.close()
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    return out, err, rc


def probe_vllm_install(client) -> tuple[str | None, dict | None]:
    """Probe managed vLLM version and serve flags from the remote host."""
    version_cmd = (
        "bash -lc 'VENV=\"$HOME/.inferix/venvs/vllm-2\"; "
        "test -x \"$VENV/bin/python\" && \"$VENV/bin/python\" -c \"import vllm; print(vllm.__version__)\"'"
    )
    version_out, _, version_rc = _exec(client, version_cmd, timeout=30)
    version = version_out.strip().splitlines()[-1] if version_rc == 0 and version_out.strip() else None

    help_cmd = (
        "bash -lc 'VENV=\"$HOME/.inferix/venvs/vllm-2\"; "
        "test -x \"$VENV/bin/vllm\" && \"$VENV/bin/vllm\" serve --help=all 2>&1 | head -c 200000'"
    )
    help_out, help_err, help_rc = _exec(client, help_cmd, timeout=45)
    help_text = help_out or help_err
    help_flags = parse_vllm_help_flags(help_text) if help_rc == 0 and help_text.strip() else None
    return version, help_flags


def record_vllm_probe(db: Session, server_id: UUID, client) -> LabServerState:
    version, help_flags = probe_vllm_install(client)
    state = get_or_create_lab_state(db, server_id)
    if version:
        state.vllm_installed_at = utcnow()
        state.vllm_version = version
    if help_flags:
        state.vllm_help_flags = help_flags
    db.commit()
    db.refresh(state)
    return state


def read_vllm_log_tail(client, lines: int = 160) -> str:
    out, err, _ = _exec(client, f"bash -lc 'tail -{int(lines)} /tmp/vllm.log 2>/dev/null || true'", timeout=20)
    return out or err


def probe_active_health(client, port: int) -> bool:
    out, _, rc = _exec(
        client,
        f"bash -lc 'curl -sf --max-time 5 http://127.0.0.1:{int(port)}/v1/models >/dev/null'",
        timeout=10,
    )
    return rc == 0 and out == ""


def _maybe_backfill_from_tasks(db: Session, server_id: UUID) -> None:
    state = get_or_create_lab_state(db, server_id)
    successful = (
        db.query(TaskRun)
        .filter(TaskRun.server_id == server_id, TaskRun.status == TaskStatus.SUCCESS)
        .order_by(TaskRun.created_at.desc())
        .limit(50)
        .all()
    )
    seen_cache_keys = {
        (row.server_id, row.model_id, row.quant_id, row.repo_id)
        for row in db.query(LabModelCache).filter(LabModelCache.server_id == server_id).all()
    }
    changed = False
    for task in successful:
        meta = task.metadata_json or {}
        step = meta.get("pipeline_step")
        if step == "init_server" and not state.initialized_at:
            state.initialized_at = task.finished_at or task.started_at or utcnow()
            changed = True
        elif step == "install_vllm" and not state.vllm_installed_at:
            state.vllm_installed_at = task.finished_at or task.started_at or utcnow()
            changed = True
        elif step == "download_model" and meta.get("model_id") and meta.get("quant_id") and meta.get("repo_id"):
            key = (server_id, UUID(str(meta["model_id"])), UUID(str(meta["quant_id"])), str(meta["repo_id"]))
            if key not in seen_cache_keys:
                row = LabModelCache(
                    server_id=server_id,
                    model_id=key[1],
                    quant_id=key[2],
                    repo_id=key[3],
                    status="ready",
                    last_download_task_id=task.id,
                    last_checked_at=task.finished_at or utcnow(),
                    metadata_json={"backfilled_from_task": str(task.id)},
                )
                db.add(row)
                seen_cache_keys.add(key)
                changed = True
        elif (
            step == "run_model"
            and not state.active_model_id
            and meta.get("model_id")
            and meta.get("quant_id")
            and meta.get("hf_repo")
            and meta.get("remote_port")
        ):
            profile = {
                "name": "backfilled-success",
                "remote_port": meta.get("remote_port"),
                "source_task_run_id": str(task.id),
            }
            state.active_model_id = UUID(str(meta["model_id"]))
            state.active_quant_id = UUID(str(meta["quant_id"]))
            state.active_model_repo = str(meta["hf_repo"])
            state.active_port = int(meta.get("remote_port") or 8000)
            state.active_endpoint = f"http://127.0.0.1:{state.active_port}/v1"
            state.active_profile_json = profile
            state.active_health_ok = True
            state.active_task_run_id = task.id
            state.active_updated_at = task.finished_at or task.started_at or utcnow()
            state.last_successful_profile_json = profile
            changed = True
    if changed:
        db.commit()


def lab_state_response(db: Session, server_id: UUID, *, refresh_client=None) -> LabStateResponse:
    _maybe_backfill_from_tasks(db, server_id)
    if refresh_client is not None:
        try:
            record_vllm_probe(db, server_id, refresh_client)
        except Exception:
            db.rollback()

    state = get_or_create_lab_state(db, server_id)
    if refresh_client is not None and state.active_port:
        try:
            state.active_health_ok = probe_active_health(refresh_client, state.active_port)
            state.active_updated_at = utcnow()
            db.commit()
            db.refresh(state)
        except Exception:
            db.rollback()

    caches = (
        db.query(LabModelCache)
        .filter(LabModelCache.server_id == server_id)
        .order_by(LabModelCache.updated_at.desc())
        .all()
    )
    active = None
    if state.active_model_id or state.active_model_repo or state.active_port:
        active = LabActiveModelOut(
            model_id=state.active_model_id,
            quant_id=state.active_quant_id,
            repo_id=state.active_model_repo,
            port=state.active_port,
            endpoint=state.active_endpoint,
            profile=state.active_profile_json,
            health_ok=state.active_health_ok,
            task_run_id=state.active_task_run_id,
            model_run_id=state.active_model_run_id,
            updated_at=state.active_updated_at,
        )

    supported_flags = []
    if isinstance(state.vllm_help_flags, dict):
        supported_flags = list(state.vllm_help_flags.get("flags") or [])

    benchmark_rows = []
    if state.active_model_repo:
        benchmarks = (
            db.query(InferenceBenchmark)
            .filter(InferenceBenchmark.model_name == state.active_model_repo)
            .order_by(InferenceBenchmark.created_at.desc())
            .limit(5)
            .all()
        )
        for benchmark in benchmarks:
            benchmark_rows.append(
                {
                    "id": str(benchmark.id),
                    "profile": benchmark.profile,
                    "tokens_per_second_avg": benchmark.tokens_per_second_avg,
                    "ttft_ms_p95": benchmark.ttft_ms_p95,
                    "vram_used_gb": benchmark.vram_used_gb,
                    "cold_start_seconds": benchmark.cold_start_seconds,
                    "created_at": benchmark.created_at.isoformat() if hasattr(benchmark.created_at, "isoformat") else benchmark.created_at,
                    "task_run_id": str(benchmark.task_run_id) if benchmark.task_run_id else None,
                }
            )

    diagnosis = [
        LabKnownIssueMatch.model_validate(match)
        for match in (state.last_failure_diagnosis_json or [])
        if isinstance(match, dict)
    ]

    return LabStateResponse(
        server_id=server_id,
        initialized=state.initialized_at is not None,
        initialized_at=state.initialized_at,
        vllm_installed=state.vllm_installed_at is not None,
        vllm_installed_at=state.vllm_installed_at,
        vllm_version=state.vllm_version,
        vllm_help_flags=state.vllm_help_flags,
        vllm_supported_flags=supported_flags,
        downloaded_models=[LabModelCacheOut.model_validate(row) for row in caches],
        active_model=active,
        last_successful_profile=state.last_successful_profile_json,
        last_failed_profile=state.last_failed_profile_json,
        last_failure_kind=state.last_failure_kind,
        last_failure_reason=state.last_failure_reason,
        last_failure_diagnosis=diagnosis,
        benchmarks=benchmark_rows,
        help_note=LAB_VLLM_HELP_NOTE,
        updated_at=state.updated_at,
    )


def response_json(response: LabStateResponse) -> dict[str, Any]:
    return json.loads(response.model_dump_json())
