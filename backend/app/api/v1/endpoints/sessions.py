"""Sessions API endpoints - Phase 3C: SSH Terminal Sessions."""

import asyncio
import json
import logging
import shlex
import time
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import websocket_api_key_valid
from app.db.session import SessionLocal, get_db
from app.models.entities import Server, Session as SessionModel, SessionCommand, SessionStatus
from app.schemas.sessions import (
    CommandRequest,
    MachineSnapshotPayload,
    SessionCommandResponse,
    SessionCreate,
    SessionListItem,
    SessionListResponse,
    SessionResponse,
)
from app.services import session_runner, session_store
from app.services.session_runner import capture_host_snapshot, strip_ansi

logger = logging.getLogger(__name__)

router = APIRouter()

_SNAPSHOT_STALE_SECONDS = 86400  # 24 h
_MAX_PTY_LOG_CHARS = 2_000_000


def _build_snapshot(session: SessionModel) -> MachineSnapshotPayload | None:
    """Extract and enrich host_snapshot from session metadata_json."""
    snap = (session.metadata_json or {}).get("host_snapshot")
    if not snap:
        return None
    captured_at = None
    is_stale = False
    raw_ts = snap.get("captured_at")
    if raw_ts:
        try:
            captured_at = datetime.fromisoformat(raw_ts)
            is_stale = (datetime.now(timezone.utc) - captured_at).total_seconds() > _SNAPSHOT_STALE_SECONDS
        except (ValueError, TypeError):
            pass
    return MachineSnapshotPayload(
        driver_version=snap.get("driver_version"),
        cuda_runtime_host=snap.get("cuda_runtime_host"),
        gpu_count=snap.get("gpu_count", 0),
        gpus=snap.get("gpus", []),
        nvlink_topology=snap.get("nvlink_topology"),
        homogeneous=snap.get("homogeneous", True),
        docker_present=snap.get("docker_present", False),
        nvidia_container_toolkit=snap.get("nvidia_container_toolkit", False),
        captured_at=captured_at,
        is_stale=is_stale,
    )


@router.post("", response_model=SessionResponse, status_code=201)
def create_session(payload: SessionCreate, db: Session = Depends(get_db)) -> SessionResponse:
    """Open a new SSH terminal session for the given server."""
    server = db.query(Server).filter(Server.id == payload.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    try:
        handle = session_runner.open_session(server)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    env_snapshot = session_runner.capture_env_snapshot(handle.channel)
    try:
        host_snapshot = capture_host_snapshot(handle.client)
    except Exception as exc:
        logger.warning("Initial host snapshot failed for server %s: %s", server.id, exc)
        host_snapshot = None

    session = SessionModel(
        server_id=server.id,
        label=payload.label,
        status=SessionStatus.ACTIVE,
        metadata_json={
            **({"env": env_snapshot} if env_snapshot else {}),
            **({"host_snapshot": host_snapshot} if host_snapshot else {}),
        } or None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    session_store.put(str(session.id), handle)

    return SessionResponse(
        id=session.id,
        server_id=session.server_id,
        label=session.label,
        status=session.status,
        started_at=session.started_at,
        terminated_at=session.terminated_at,
        pty_log=None,
        commands=[],
        created_at=session.created_at,
        latest_snapshot=_build_snapshot(session),
    )


@router.get("", response_model=SessionListResponse)
def list_sessions(
    server_id: UUID | None = Query(None),
    status: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> SessionListResponse:
    """List sessions with optional server_id and status filters."""
    query = db.query(SessionModel)
    if server_id is not None:
        query = query.filter(SessionModel.server_id == server_id)
    if status is not None:
        query = query.filter(SessionModel.status == status)

    total = query.count()
    sessions = query.order_by(SessionModel.created_at.desc()).offset(skip).limit(limit).all()

    # Bulk count commands per session to avoid N+1.
    if sessions:
        session_ids = [s.id for s in sessions]
        counts_rows = (
            db.query(SessionCommand.session_id, func.count(SessionCommand.id))
            .filter(SessionCommand.session_id.in_(session_ids))
            .group_by(SessionCommand.session_id)
            .all()
        )
        counts = {str(row[0]): row[1] for row in counts_rows}
    else:
        counts = {}

    server_ids = list({s.server_id for s in sessions})
    if server_ids:
        servers = db.query(Server.id, Server.hostname).filter(Server.id.in_(server_ids)).all()
        hostname_map = {str(row[0]): row[1] for row in servers}
    else:
        hostname_map = {}

    # Detect which sessions have PTY content without loading the full log text
    pty_set: set[str] = set()
    if sessions:
        pty_rows = (
            db.query(SessionModel.id)
            .filter(
                SessionModel.id.in_(session_ids),
                SessionModel.pty_log.isnot(None),
                SessionModel.pty_log != "",
            )
            .all()
        )
        pty_set = {str(row[0]) for row in pty_rows}

    items = [
        SessionListItem(
            id=s.id,
            server_id=s.server_id,
            server_hostname=hostname_map.get(str(s.server_id)),
            label=s.label,
            status=s.status,
            started_at=s.started_at,
            terminated_at=s.terminated_at,
            created_at=s.created_at,
            command_count=counts.get(str(s.id), 0),
            has_pty_log=str(s.id) in pty_set,
        )
        for s in sessions
    ]

    return SessionListResponse(items=items, total=total)


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: UUID, db: Session = Depends(get_db)) -> SessionResponse:
    """Retrieve a session with its full command history and latest host snapshot."""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(
        id=session.id,
        server_id=session.server_id,
        label=session.label,
        status=session.status,
        started_at=session.started_at,
        terminated_at=session.terminated_at,
        pty_log=strip_ansi(session.pty_log) if session.pty_log else None,
        commands=[SessionCommandResponse.model_validate(cmd) for cmd in session.commands],
        created_at=session.created_at,
        latest_snapshot=_build_snapshot(session),
    )


@router.post("/{session_id}/refresh-snapshot", response_model=MachineSnapshotPayload)
def refresh_snapshot(session_id: UUID, db: Session = Depends(get_db)) -> MachineSnapshotPayload:
    """Re-probe the live SSH channel and update the session's host snapshot."""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is terminated")

    handle = session_store.get(str(session_id))
    if handle is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")

    try:
        snapshot_data = capture_host_snapshot(handle.client)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Snapshot capture failed: {exc}") from exc

    metadata = dict(session.metadata_json or {})
    metadata["host_snapshot"] = snapshot_data
    session.metadata_json = metadata
    db.commit()

    return _build_snapshot(session)  # type: ignore[return-value]


@router.delete("/{session_id}", status_code=204)
def terminate_session(session_id: UUID, db: Session = Depends(get_db)) -> None:
    """Terminate an active session (idempotent)."""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status == SessionStatus.TERMINATED:
        return

    handle = session_store.remove(str(session_id))
    if handle:
        session_runner.close_session(handle)

    session.status = SessionStatus.TERMINATED
    session.terminated_at = datetime.now(timezone.utc)
    db.commit()


# ── WebSocket PTY ─────────────────────────────────────────────────────────────

@router.websocket("/{session_id}/pty")
async def pty_websocket(session_id: UUID, websocket: WebSocket) -> None:
    """Bi-directional PTY stream over WebSocket.

    Binary frames carry raw PTY bytes in both directions.
    Text frames carry JSON control messages: {"type":"resize","cols":N,"rows":N}

    B5: no long-lived DB session is held for the WebSocket lifetime.
    Each flush opens its own SessionLocal() and closes it immediately.
    """
    if not websocket_api_key_valid(websocket):
        await websocket.close(code=1008, reason="Authentication required")
        return

    with SessionLocal() as _db:
        _session = _db.query(SessionModel).filter(SessionModel.id == session_id).first()
        if not _session:
            await websocket.close(code=1008, reason="Session not found")
            return
        if _session.status == SessionStatus.TERMINATED:
            await websocket.close(code=1008, reason="Session is terminated")
            return

    handle = session_store.get(str(session_id))
    if handle is None:
        await websocket.close(code=1008, reason="No active SSH handle — session may have restarted")
        return

    if session_store.is_pty_active(str(session_id)):
        await websocket.close(code=1008, reason="A terminal is already connected to this session")
        return

    await websocket.accept()
    session_store.mark_pty_active(str(session_id))

    # Short read timeout so recv() in the executor yields regularly.
    handle.channel.settimeout(0.05)

    pending_pty_chunks: list[bytes] = []

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _flush_to_db() -> None:
        """Write any unflushed PTY bytes to the session's pty_log column.

        Opens a fresh DB session per flush so the connection is not held open
        for the full WebSocket lifetime (B5 fix).
        """
        if not pending_pty_chunks:
            return
        data = b"".join(pending_pty_chunks)
        pending_pty_chunks.clear()
        text = data.decode(errors="replace")
        with SessionLocal() as _db:
            session_obj = _db.query(SessionModel).filter(SessionModel.id == session_id).first()
            if session_obj:
                merged = (session_obj.pty_log or "") + text
                if len(merged) > _MAX_PTY_LOG_CHARS:
                    merged = merged[-_MAX_PTY_LOG_CHARS:]
                session_obj.pty_log = merged
                _db.commit()

    async def _send_output() -> None:
        """Relay PTY bytes from the SSH channel to the WebSocket."""
        while not stop_event.is_set():
            try:
                data: bytes = await loop.run_in_executor(None, handle.channel.recv, 4096)
                if not data:
                    stop_event.set()
                    break
                pending_pty_chunks.append(data)
                await websocket.send_bytes(data)
            except TimeoutError:
                continue
            except Exception:
                stop_event.set()
                break

    async def _recv_input() -> None:
        """Relay keyboard input and resize events from WebSocket to the SSH channel."""
        try:
            while not stop_event.is_set():
                msg = await websocket.receive()
                if msg["type"] == "websocket.disconnect":
                    stop_event.set()
                    break
                raw_bytes: bytes | None = msg.get("bytes")
                raw_text: str | None = msg.get("text")
                if raw_bytes:
                    handle.channel.sendall(raw_bytes)
                elif raw_text:
                    try:
                        ctrl = json.loads(raw_text)
                        if ctrl.get("type") == "resize":
                            handle.channel.resize_pty(
                                width=int(ctrl.get("cols", 80)),
                                height=int(ctrl.get("rows", 24)),
                            )
                    except (json.JSONDecodeError, Exception):
                        pass
        except WebSocketDisconnect:
            stop_event.set()
        except Exception:
            stop_event.set()

    async def _periodic_flush() -> None:
        """Flush accumulated PTY output to DB every 30 s so history is visible during live sessions."""
        while not stop_event.is_set():
            await asyncio.sleep(30)
            if stop_event.is_set():
                break
            try:
                _flush_to_db()
            except Exception:
                pass  # Non-fatal — final flush in the finally block will catch remainder

    send_task = asyncio.create_task(_send_output())
    recv_task = asyncio.create_task(_recv_input())
    flush_task = asyncio.create_task(_periodic_flush())
    try:
        await asyncio.wait([send_task, recv_task], return_when=asyncio.FIRST_COMPLETED)
    finally:
        send_task.cancel()
        recv_task.cancel()
        flush_task.cancel()
        session_store.clear_pty_active(str(session_id))

        # Final flush: persist any bytes not yet written by the periodic flusher.
        try:
            _flush_to_db()
        except Exception:
            pass


# ── HTTP command mode (scripted / API use) ────────────────────────────────────

@router.post("/{session_id}/commands", response_model=SessionCommandResponse, status_code=201)
def run_command(
    session_id: UUID,
    body: CommandRequest,
    db: Session = Depends(get_db),
):
    """Execute a single command via the sentinel pattern (for scripted/API use).

    For interactive use, connect via the WebSocket PTY endpoint instead.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is already terminated")

    handle = session_store.get(str(session_id))
    if handle is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")

    seq_num = (
        db.query(func.count(SessionCommand.id))
        .filter(SessionCommand.session_id == session_id)
        .scalar()
        or 0
    ) + 1

    timeout = min(body.timeout, 300)

    t_start = time.monotonic()
    try:
        stdout, stderr, exit_code = session_runner.execute_command(
            handle.channel, body.command, timeout=float(timeout)
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    duration_ms = int((time.monotonic() - t_start) * 1000)

    cmd_row = SessionCommand(
        session_id=session.id,
        sequence_num=seq_num,
        command=body.command,
        stdout=stdout,
        stderr=stderr,
        exit_code=exit_code,
        duration_ms=duration_ms,
    )
    db.add(cmd_row)
    db.commit()
    db.refresh(cmd_row)

    return SessionCommandResponse(
        id=cmd_row.id,
        session_id=cmd_row.session_id,
        sequence_num=cmd_row.sequence_num,
        command=cmd_row.command,
        stdout=cmd_row.stdout,
        stderr=cmd_row.stderr,
        exit_code=cmd_row.exit_code,
        executed_at=cmd_row.executed_at,
        duration_ms=cmd_row.duration_ms,
        created_at=cmd_row.created_at,
    )


def _run_async_session_command(command_id: str, session_id: str, command: str, timeout: int) -> None:
    """Run a recorded command on an isolated SSH exec channel and patch its row."""
    handle = session_store.get(session_id)
    stdout_text = ""
    stderr_text = ""
    exit_code = 1
    started = time.monotonic()
    try:
        if handle is None:
            raise RuntimeError("No active SSH handle for this session")
        wrapped = f"bash -lc {shlex.quote(command)}"
        stdin, stdout, stderr = handle.client.exec_command(wrapped, timeout=timeout)
        stdin.close()
        exit_code = stdout.channel.recv_exit_status()
        stdout_text = stdout.read().decode(errors="replace")
        stderr_text = stderr.read().decode(errors="replace")
    except Exception as exc:
        stderr_text = str(exc)
        exit_code = 1
    duration_ms = int((time.monotonic() - started) * 1000)
    with SessionLocal() as bg_db:
        row = bg_db.query(SessionCommand).filter(SessionCommand.id == command_id).first()
        if row:
            row.stdout = stdout_text
            row.stderr = stderr_text
            row.exit_code = exit_code
            row.duration_ms = duration_ms
            bg_db.commit()


@router.post("/{session_id}/commands/async", response_model=SessionCommandResponse, status_code=202)
def queue_command(
    session_id: UUID,
    body: CommandRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Record a command immediately and execute it in the background.

    This avoids long browser/proxy requests for Docker pulls and model downloads.
    The command is run on an isolated SSH exec channel, not the interactive PTY.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is already terminated")

    handle = session_store.get(str(session_id))
    if handle is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")

    seq_num = (
        db.query(func.count(SessionCommand.id))
        .filter(SessionCommand.session_id == session_id)
        .scalar()
        or 0
    ) + 1

    cmd_row = SessionCommand(
        session_id=session.id,
        sequence_num=seq_num,
        command=body.command,
        stdout="",
        stderr="",
        exit_code=None,
        duration_ms=None,
    )
    db.add(cmd_row)
    db.commit()
    db.refresh(cmd_row)

    background_tasks.add_task(
        _run_async_session_command,
        str(cmd_row.id),
        str(session_id),
        body.command,
        min(max(body.timeout, 30), 7200),
    )

    return SessionCommandResponse(
        id=cmd_row.id,
        session_id=cmd_row.session_id,
        sequence_num=cmd_row.sequence_num,
        command=cmd_row.command,
        stdout=cmd_row.stdout,
        stderr=cmd_row.stderr,
        exit_code=cmd_row.exit_code,
        executed_at=cmd_row.executed_at,
        duration_ms=cmd_row.duration_ms,
        created_at=cmd_row.created_at,
    )


@router.post("/{session_id}/interrupt", status_code=204)
def interrupt_session(session_id: UUID, db: Session = Depends(get_db)) -> None:
    """Send Ctrl+C (SIGINT) to interrupt a running command in HTTP command mode."""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == SessionStatus.TERMINATED:
        raise HTTPException(status_code=409, detail="Session is terminated")

    handle = session_store.get(str(session_id))
    if handle is None:
        raise HTTPException(status_code=409, detail="No active SSH handle for this session")

    handle.channel.sendall(b"\x03")


# ── Downloads ─────────────────────────────────────────────────────────────────

@router.get("/{session_id}/download", response_class=PlainTextResponse)
def download_session_transcript(session_id: UUID, db: Session = Depends(get_db)) -> str:
    """Download the full session transcript as plain text."""
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    lines = [
        f"Session: {session.id}",
        f"Server:  {session.server_id}",
        f"Label:   {session.label or '-'}",
        f"Status:  {session.status}",
        f"Started: {session.started_at}",
        "=" * 60,
        "",
    ]

    if session.pty_log:
        lines.append("[PTY Terminal Output]")
        lines.append(strip_ansi(session.pty_log))
        lines.append("-" * 60)
        lines.append("")

    for cmd in session.commands:
        lines.append(f"[{cmd.sequence_num}] $ {cmd.command}")
        if cmd.stdout:
            lines.append(cmd.stdout)
        if cmd.stderr:
            lines.append(cmd.stderr)
        lines.append(f"exit code: {cmd.exit_code}  duration: {cmd.duration_ms}ms")
        lines.append("-" * 40)

    return chr(10).join(lines)


@router.get("/{session_id}/commands/summary")
def get_commands_summary(session_id: UUID, db: Session = Depends(get_db)) -> dict:
    """Parse PTY log markers into a structured command history.

    Requires PROMPT_COMMAND to have been injected (sessions opened after 5A.2).
    Returns empty list for older sessions or sessions without a PTY log.
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.pty_log:
        return {"commands": [], "total": 0}
    commands = session_runner.parse_pty_commands(session.pty_log)
    return {"commands": commands, "total": len(commands)}


@router.post("/{session_id}/to-playbook")
def convert_to_playbook(
    session_id: UUID,
    body: dict | None = None,
    save: bool = Query(False),
    name: str | None = Query(None),
    engine: str | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    """Use Claude (Haiku) to convert PTY command history into an Ansible playbook.

    Requires `anthropic_api_key` in platform_settings.
    Body: {"context": str, "keep_indices": list[int] | null}
    Query: ?save=true&name=<playbook-name>&engine=VLLM
    """
    from app.models.entities import PlatformSetting, Playbook, ModelVariant
    import os

    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.pty_log:
        raise HTTPException(status_code=422, detail="No PTY log available for this session")

    all_commands = session_runner.parse_pty_commands(session.pty_log)
    if not all_commands:
        raise HTTPException(
            status_code=422,
            detail="No parseable commands found. Session may predate PROMPT_COMMAND injection.",
        )

    body = body or {}
    keep_indices: list[int] | None = body.get("keep_indices")
    context: str = body.get("context", "")

    # Filter to kept commands only if indices provided
    if keep_indices is not None:
        kept = [c for i, c in enumerate(all_commands) if i in keep_indices]
    else:
        kept = all_commands

    if not kept:
        raise HTTPException(status_code=422, detail="No commands selected to convert.")

    # Resolve Anthropic API key
    setting_row = (
        db.query(PlatformSetting)
        .filter(PlatformSetting.key == "anthropic_api_key")
        .first()
    )
    api_key = (setting_row.value if setting_row else None) or os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="anthropic_api_key not configured. Set it in Profile > Settings.",
        )

    # Build env comment header from session metadata
    env_header = ""
    if session.metadata_json and session.metadata_json.get("env"):
        env = session.metadata_json["env"]
        lines = ["# Environment snapshot at session start:"]
        if env.get("nvidia_smi"):
            lines.append(f"# GPU: {env['nvidia_smi']}")
        if env.get("nvcc"):
            lines.append(f"# CUDA: {env['nvcc']}")
        if env.get("docker"):
            lines.append(f"# Docker: {env['docker']}")
        env_header = "\n".join(lines) + "\n#\n"

    cmd_lines = "\n".join(
        f"[exit={c['exit_code']} {c['duration_ms']}ms] $ {c['command']}"
        + (f"\n{c['output']}" if c.get("output") else "")
        for c in kept
    )

    prompt = (
        f"Here are shell commands run on a GPU server{' to ' + context if context else ''}.\n"
        f"Convert them into an idempotent Ansible playbook (YAML). "
        f"Skip commands that failed (exit code != 0). "
        f"Add a brief task name for each step.\n\n"
        f"Commands:\n{cmd_lines}"
    )

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        playbook_yaml = env_header + message.content[0].text
    except Exception as exc:
        logger.error("Anthropic API error in to-playbook: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}") from exc

    result: dict = {"playbook_yaml": playbook_yaml, "command_count": len(kept)}

    if save:
        if not name or not name.strip():
            raise HTTPException(status_code=422, detail="name is required when save=true")

        # Build setup.sh from the kept commands (only exit-0 ones)
        setup_lines = ["#!/usr/bin/env bash", "set -euo pipefail", ""]
        if env_header:
            setup_lines.insert(0, env_header.rstrip())
            setup_lines.insert(1, "")
        for cmd in kept:
            if cmd.get("exit_code") == 0:
                setup_lines.append(cmd["command"])
        setup_sh = "\n".join(setup_lines) + "\n"

        try:
            from app.services.playbook_writer import write_playbook_to_local_repo
            write_result = write_playbook_to_local_repo(
                name=name.strip(),
                setup_sh=setup_sh,
                ansible_yaml=playbook_yaml,
                session_id=str(session_id),
            )
        except Exception as exc:
            logger.warning("playbook_writer failed: %s", exc)
            write_result = {"git_repo": "local", "git_commit": None}

        from app.models.entities import EngineKind as EK
        engine_enum = None
        if engine:
            try:
                engine_enum = EK(engine.upper())
            except ValueError:
                pass

        playbook = Playbook(
            name=name.strip(),
            git_repo=write_result["git_repo"],
            git_branch="main",
            git_commit=write_result.get("git_commit"),
            source_session_id=session_id,
            engine=engine_enum,
        )
        db.add(playbook)
        db.commit()
        db.refresh(playbook)

        result["playbook_id"] = str(playbook.id)

    return result


@router.get("/{session_id}/commands/{cmd_id}/download", response_class=PlainTextResponse)
def download_command(session_id: UUID, cmd_id: UUID, db: Session = Depends(get_db)) -> str:
    """Download a single command's output as plain text."""
    cmd = (
        db.query(SessionCommand)
        .filter(
            SessionCommand.id == cmd_id,
            SessionCommand.session_id == session_id,
        )
        .first()
    )
    if not cmd:
        raise HTTPException(status_code=404, detail="Command not found")

    lines = [f"$ {cmd.command}", "=" * 60]
    if cmd.stdout:
        lines.append(cmd.stdout)
    if cmd.stderr:
        lines.append(cmd.stderr)
    lines.append(f"exit code: {cmd.exit_code}  duration: {cmd.duration_ms}ms")
    return chr(10).join(lines)
