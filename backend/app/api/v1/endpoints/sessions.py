"""Sessions API endpoints - Phase 3C: SSH Terminal Sessions."""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import Server, Session as SessionModel, SessionCommand, SessionStatus
from app.schemas.sessions import (
    CommandRequest,
    SessionCommandResponse,
    SessionCreate,
    SessionListItem,
    SessionListResponse,
    SessionResponse,
)
from app.services import session_runner, session_store
from app.services.session_runner import strip_ansi

logger = logging.getLogger(__name__)

router = APIRouter()


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

    session = SessionModel(
        server_id=server.id,
        label=payload.label,
        status=SessionStatus.ACTIVE,
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
    """Retrieve a session with its full command history."""
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
    )


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
async def pty_websocket(session_id: UUID, websocket: WebSocket, db: Session = Depends(get_db)) -> None:
    """Bi-directional PTY stream over WebSocket.

    Binary frames carry raw PTY bytes in both directions.
    Text frames carry JSON control messages: {"type":"resize","cols":N,"rows":N}
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        await websocket.close(code=1008, reason="Session not found")
        return
    if session.status == SessionStatus.TERMINATED:
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

    pty_chunks: list[bytes] = []
    # Tracks how many bytes (joined) have already been flushed to DB so periodic
    # and final flushes never double-write the same bytes.
    flushed_len: list[int] = [0]

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _flush_to_db() -> None:
        """Write any unflushed PTY bytes to the session's pty_log column."""
        all_data = b"".join(pty_chunks)
        new_data = all_data[flushed_len[0]:]
        if not new_data:
            return
        text = new_data.decode(errors="replace")
        flushed_len[0] = len(all_data)
        session_obj = db.query(SessionModel).filter(SessionModel.id == session_id).first()
        if session_obj:
            session_obj.pty_log = (session_obj.pty_log or "") + text
            db.commit()

    async def _send_output() -> None:
        """Relay PTY bytes from the SSH channel to the WebSocket."""
        while not stop_event.is_set():
            try:
                data: bytes = await loop.run_in_executor(None, handle.channel.recv, 4096)
                if not data:
                    stop_event.set()
                    break
                pty_chunks.append(data)
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
    body: dict = {},
    db: Session = Depends(get_db),
) -> dict:
    """Use Claude (Haiku) to convert PTY command history into an Ansible playbook.

    Requires `anthropic_api_key` in platform_settings.
    Optional body: {"context": "Deploy vLLM on GPU server"}
    """
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.pty_log:
        raise HTTPException(status_code=422, detail="No PTY log available for this session")

    commands = session_runner.parse_pty_commands(session.pty_log)
    if not commands:
        raise HTTPException(
            status_code=422,
            detail="No parseable commands found. Session may predate PROMPT_COMMAND injection.",
        )

    # Resolve Anthropic API key from platform_settings → env var
    from app.models.entities import PlatformSetting
    import os

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

    context = (body or {}).get("context", "")
    cmd_lines = "\n".join(
        f"[exit={c['exit_code']} {c['duration_ms']}ms] $ {c['command']}"
        + (f"\n{c['output']}" if c.get("output") else "")
        for c in commands
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
        playbook_yaml = message.content[0].text
    except Exception as exc:
        logger.error("Anthropic API error in to-playbook: %s", exc)
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}") from exc

    return {"playbook_yaml": playbook_yaml, "command_count": len(commands)}


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
