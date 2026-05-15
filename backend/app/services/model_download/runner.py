"""Download runner: SSH-based orchestration of the remote helper, session registry."""

from __future__ import annotations

import json
import logging
import shlex
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import UUID

from app.services.model_download.allowlist import resolve_allowlist
from app.services.model_download.remote_helper import REMOTE_HELPER_SCRIPT
from app.services.model_download.session import DownloadSession, FileProgress

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as DbSession

logger = logging.getLogger(__name__)

# ── Module-level session registry ─────────────────────────────────────────────

_SESSIONS: dict[str, DownloadSession] = {}
_SESSIONS_LOCK = threading.Lock()

REMOTE_BASE_DIR = "~/.inferix/downloads"


@dataclass
class StartResult:
    download_id: str
    task_run_id: str
    repo_id: str
    files: list[dict]
    total_bytes: int
    cached_bytes: int


# ── Public API ─────────────────────────────────────────────────────────────────


def start_model_download(
    *,
    db: "DbSession",
    server_id: UUID,
    session_id: UUID,
    model_id: UUID,
    quant_id: UUID,
) -> StartResult:
    """Resolve allow-list, create session, spawn SSH thread. Idempotent while in-flight."""
    from app.models.entities import (
        Model as ModelEntity,
        ModelQuant as ModelQuantEntity,
        Server,
        TaskRun,
        TaskStatus,
    )
    from app.services import session_store
    from app.services.settings_service import get_setting

    model = db.query(ModelEntity).filter(ModelEntity.id == model_id).first()
    quant = db.query(ModelQuantEntity).filter(ModelQuantEntity.id == quant_id).first()
    server = db.query(Server).filter(Server.id == server_id).first()

    if not model:
        raise ValueError(f"Model {model_id} not found")
    if not quant:
        raise ValueError(f"Quant {quant_id} not found")
    if not server:
        raise ValueError(f"Server {server_id} not found")

    allow = resolve_allowlist(quant, model)
    download_id = f"srv:{server_id}::repo:{allow.repo_id}::key:{allow.files_key}"

    with _SESSIONS_LOCK:
        existing = _SESSIONS.get(download_id)
        if existing and existing.finished_at is None:
            snap = existing.snapshot()
            return StartResult(
                download_id=download_id,
                task_run_id=str(existing._task_run_id),  # type: ignore[attr-defined]
                repo_id=allow.repo_id,
                files=snap["files"],
                total_bytes=snap["total"],
                cached_bytes=sum(
                    f["size"] for f in snap["files"] if f["status"] == "cached"
                ),
            )

    # Create TaskRun record
    task_run = TaskRun(
        task_type="lab.pipeline.download_model",
        status=TaskStatus.PENDING,
        server_id=server_id,
        started_at=datetime.now(timezone.utc),
        metadata_json={
            "session_id": str(session_id),
            "pipeline_step": "download_model",
            "download_id": download_id,
            "repo_id": allow.repo_id,
            "model_id": str(model_id),
            "quant_id": str(quant_id),
        },
    )
    db.add(task_run)
    db.commit()
    db.refresh(task_run)
    task_run_id = str(task_run.id)
    try:
        from app.services.lab_state import upsert_model_cache

        upsert_model_cache(
            db,
            server_id=server_id,
            model_id=model_id,
            quant_id=quant_id,
            repo_id=allow.repo_id,
            status="downloading",
            task_run_id=task_run.id,
            metadata={"download_id": download_id},
        )
    except Exception:
        logger.exception("Failed to persist Lab model-cache start state")

    session = DownloadSession(download_id=download_id, repo_id=allow.repo_id)
    session._task_run_id = task_run_id  # type: ignore[attr-defined]

    with _SESSIONS_LOCK:
        _SESSIONS[download_id] = session

    handle = session_store.get(str(session_id))
    if handle is None:
        with _SESSIONS_LOCK:
            _SESSIONS.pop(download_id, None)
        raise RuntimeError("No active SSH handle for this session")

    hf_token = get_setting("hf_token", db)

    t = threading.Thread(
        target=_download_thread,
        args=(session, handle.client, allow, download_id, hf_token, task_run_id),
        daemon=True,
    )
    t.start()

    # Return immediately with empty files list (populated once thread reads "start" event)
    return StartResult(
        download_id=download_id,
        task_run_id=task_run_id,
        repo_id=allow.repo_id,
        files=[],
        total_bytes=0,
        cached_bytes=0,
    )


def get_download_status(download_id: str) -> dict | None:
    """Return a snapshot dict or None if not found."""
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(download_id)
    if session is None:
        return None
    return session.snapshot()


def cancel_download(download_id: str) -> bool:
    """Write cancel sentinel on the remote server; mark session error."""
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(download_id)
    if session is None:
        return False
    if session.finished_at is not None:
        return False
    # Mark locally immediately so SSE sees it
    session.finish(error="cancelled")
    return True


def attach(download_id: str) -> DownloadSession | None:
    """Return the in-memory session for SSE streaming, or None."""
    with _SESSIONS_LOCK:
        return _SESSIONS.get(download_id)


# ── Background thread ─────────────────────────────────────────────────────────


def _safe_token(files_key: str) -> str:
    """URL/filesystem-safe token for naming helper + ndjson files on the remote."""
    return files_key  # already a short hex hash from allowlist.resolve_allowlist


def _build_helper_cmd(
    helper_path: str,
    ndjson_path: str,
    download_id: str,
    allow,
    token_path: str | None,
) -> str:
    """Return the shell command that runs the helper on the remote."""
    exact_args = " ".join(
        f"--exact-file {shlex.quote(f)}" for f in allow.exact_files
    )
    pattern_args = " ".join(
        f"--allow-pattern {shlex.quote(p)}" for p in allow.allow_patterns
    )
    token_export = ""
    cleanup = ""
    if token_path:
        quoted_token_path = shlex.quote(token_path)
        token_export = f'export HF_TOKEN="$(cat {quoted_token_path})"; '
        cleanup = f"trap 'rm -f {quoted_token_path}' EXIT; "

    # Prefer the latest ~/.inferix/venvs/vllm-*/bin/python (where huggingface_hub
    # was installed by the install-vllm step). Fall back to system python3 if
    # no inferix venv exists — the helper will surface a clearer error in that case.
    pybin_probe = (
        'PYBIN=$(ls -1d ~/.inferix/venvs/vllm-*/bin/python 2>/dev/null '
        '| sort -V | tail -1); PYBIN=${PYBIN:-python3}'
    )
    # -u forces unbuffered stdout/stderr so NDJSON lines flush immediately
    # through the SSH transport instead of waiting for ~8KB block buffer to fill.
    # PYTHONUNBUFFERED=1 belt-and-suspenders for any subprocess the helper spawns.
    return (
        f"{pybin_probe} && "
        f"{cleanup}"
        f"{token_export}"
        f'PYTHONUNBUFFERED=1 "$PYBIN" -u {shlex.quote(helper_path)} '
        f"--repo-id {shlex.quote(allow.repo_id)} "
        f"--download-id {shlex.quote(download_id)} "
        f"--cache-dir ~/.cache/huggingface "
        f"--ndjson-out {shlex.quote(ndjson_path)} "
        f"{exact_args} "
        f"{pattern_args} "
    )


def _upload_helper(client, files_key: str) -> tuple[str, str]:
    """Write helper to remote; return (absolute helper_path, absolute ndjson_path)."""
    import io

    sftp = client.open_sftp()
    try:
        # SFTP doesn't expand ~ — resolve to absolute home via normalize(".")
        home = sftp.normalize(".")
        remote_dir = f"{home}/.inferix/downloads"

        # mkdir -p via SFTP (handles nested creation)
        for segment in (".inferix", ".inferix/downloads"):
            full = f"{home}/{segment}"
            try:
                sftp.stat(full)
            except FileNotFoundError:
                sftp.mkdir(full)

        token = _safe_token(files_key)
        helper_path = f"{remote_dir}/helper_{token}.py"
        ndjson_path = f"{remote_dir}/{token}.ndjson"
        sftp.putfo(io.BytesIO(REMOTE_HELPER_SCRIPT.encode()), helper_path)
    finally:
        sftp.close()

    return helper_path, ndjson_path


def _upload_token_file(client, files_key: str, hf_token: str | None) -> str | None:
    """Write the HF token to a chmod-600 remote file instead of process argv."""
    if not hf_token:
        return None
    import io

    sftp = client.open_sftp()
    try:
        home = sftp.normalize(".")
        for segment in (".inferix", ".inferix/secrets"):
            full = f"{home}/{segment}"
            try:
                sftp.stat(full)
            except FileNotFoundError:
                sftp.mkdir(full)
        token_path = f"{home}/.inferix/secrets/hf_token_{_safe_token(files_key)}"
        sftp.putfo(io.BytesIO(hf_token.encode()), token_path)
        sftp.chmod(token_path, 0o600)
        return token_path
    finally:
        sftp.close()


def _dispatch(session: DownloadSession, ev: dict) -> None:
    """Map a parsed NDJSON event from the remote helper into session state."""
    t = ev.get("t")

    if t == "start":
        raw_files: list[dict] = ev.get("files") or []
        with session._lock:
            session.files = [
                FileProgress(
                    filename=f["name"],
                    size=f.get("size", 0),
                    status="cached" if f.get("cached") else "pending",
                    downloaded=f.get("size", 0) if f.get("cached") else 0,
                )
                for f in raw_files
            ]
        session.emit(force=True)

    elif t == "file_start":
        i = ev.get("i", 0)
        if 0 <= i < len(session.files):
            session.start_file(i)

    elif t == "chunk":
        i = ev.get("i", 0)
        downloaded = ev.get("downloaded", 0)
        total = ev.get("total", 0)
        if 0 <= i < len(session.files):
            session.on_chunk(i, downloaded, total)

    elif t == "file_done":
        i = ev.get("i", 0)
        ok = bool(ev.get("ok", True))
        error = ev.get("error", "") or ""
        if 0 <= i < len(session.files):
            session.finish_file(i, ok=ok, error=error)

    elif t == "done":
        error = ev.get("error", "") or ""
        session.finish(error=error)


def _update_task_run_status(task_run_id: str, success: bool, error: str) -> None:
    """Update TaskRun record in a short-lived DB session."""
    try:
        from app.db.session import SessionLocal
        from app.models.entities import TaskRun, TaskStatus
        from app.services.lab_state import upsert_model_cache
        from app.workers.utils import _finish_task_run

        db = SessionLocal()
        try:
            task_run = db.query(TaskRun).filter(TaskRun.id == UUID(task_run_id)).first()
            if task_run:
                task_run.status = TaskStatus.SUCCESS if success else TaskStatus.FAILED
                if error:
                    task_run.error_summary = error[:1000]
                db.commit()
                metadata = task_run.metadata_json or {}
                if metadata.get("server_id") or task_run.server_id:
                    repo_id = metadata.get("repo_id")
                    model_id = metadata.get("model_id")
                    quant_id = metadata.get("quant_id")
                    if repo_id and model_id and quant_id and task_run.server_id:
                        upsert_model_cache(
                            db,
                            server_id=task_run.server_id,
                            model_id=UUID(str(model_id)),
                            quant_id=UUID(str(quant_id)),
                            repo_id=str(repo_id),
                            status="ready" if success else "failed",
                            task_run_id=task_run.id,
                            error=error or None,
                        )
                _finish_task_run(task_run, db)
        finally:
            db.close()
    except Exception:
        logger.exception("Failed to update task_run %s", task_run_id)


def _download_thread(
    session: DownloadSession,
    client,
    allow,
    download_id: str,
    hf_token: str | None,
    task_run_id: str,
) -> None:
    """Runs in daemon thread: uploads helper, streams NDJSON, dispatches into session."""
    finished_ok = False
    error_msg = ""
    try:
        # Upload helper script via SFTP (returns absolute paths)
        try:
            helper_path, ndjson_path = _upload_helper(client, allow.files_key)
        except Exception as exc:
            session.finish(error=f"Failed to upload helper: {exc}")
            _update_task_run_status(task_run_id, False, str(exc))
            return

        try:
            token_path = _upload_token_file(client, allow.files_key, hf_token)
        except Exception as exc:
            session.finish(error=f"Failed to upload token file: {exc}")
            _update_task_run_status(task_run_id, False, str(exc))
            return

        # Build run command. The token path is passed, not the token value.
        run_cmd = _build_helper_cmd(helper_path, ndjson_path, download_id, allow, token_path)

        # Execute helper; stream stdout line by line
        wrapped = f"bash -lc {shlex.quote(run_cmd)}"
        _, stdout, _ = client.exec_command(wrapped, timeout=7200)

        got_done = False
        for raw in stdout:
            line = raw.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("helper NDJSON parse error: %r", line[:200])
                continue
            _dispatch(session, ev)
            if ev.get("t") == "done":
                got_done = True
                error_msg = ev.get("error", "") or ""

        if not got_done:
            error_msg = "Helper exited without 'done' event"
            session.finish(error=error_msg)
        else:
            if session.finished_at is None:
                session.finish(error=error_msg)
            finished_ok = not error_msg and not any(
                f.status == "failed" for f in session.files
            )

    except Exception as exc:
        error_msg = str(exc)
        logger.exception("Download thread failed for %s", download_id)
        if session.finished_at is None:
            session.finish(error=error_msg)

    _update_task_run_status(task_run_id, finished_ok, error_msg)
