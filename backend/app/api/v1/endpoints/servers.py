import socket
import time as _time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import Server, ServerStatus, TaskRun, TaskStatus
from app.schemas.servers import ServerCreate, ServerListResponse, ServerResponse, ServerUpdate

router = APIRouter()


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=ServerListResponse)
def list_servers(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ServerListResponse:
    total = db.query(Server).count()
    items = db.query(Server).offset(skip).limit(limit).all()
    return ServerListResponse(items=items, total=total)


@router.post("", response_model=ServerResponse, status_code=201)
def create_server(payload: ServerCreate, db: Session = Depends(get_db)) -> Server:
    server = Server(**payload.model_dump())
    db.add(server)
    db.commit()
    db.refresh(server)
    from app.workers.tasks import provision_server
    provision_server.delay(str(server.id))
    return server


@router.get("/{server_id}", response_model=ServerResponse)
def get_server(server_id: UUID, db: Session = Depends(get_db)) -> Server:
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


@router.patch("/{server_id}", response_model=ServerResponse)
def update_server(server_id: UUID, payload: ServerUpdate, db: Session = Depends(get_db)) -> Server:
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(server, key, value)
    db.commit()
    db.refresh(server)
    return server


@router.delete("/{server_id}", status_code=204)
def delete_server(server_id: UUID, db: Session = Depends(get_db)) -> None:
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    db.delete(server)
    db.commit()


# ── SSH ───────────────────────────────────────────────────────────────────────

class SSHTestStep(BaseModel):
    step: str
    success: bool
    message: str
    elapsed_ms: int


class SSHTestResponse(BaseModel):
    success: bool
    message: str
    steps: list[SSHTestStep]


class ExecRequest(BaseModel):
    command: str


class ExecResponse(BaseModel):
    task_run_id: str


@router.post("/{server_id}/ssh/test", response_model=SSHTestResponse)
def test_ssh_connection(
    server_id: UUID,
    promote_if_reachable: bool = Query(True),
    db: Session = Depends(get_db),
) -> SSHTestResponse:
    """Test SSH connectivity step by step; promotes PROVISIONING→READY on success."""
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    import paramiko
    from app.services.ssh_manager import _load_pkey_from_content

    steps: list[SSHTestStep] = []

    # Step 1 — TCP connect
    t0 = _time.monotonic()
    try:
        with socket.create_connection((server.hostname, server.ssh_port), timeout=10):
            pass
        steps.append(SSHTestStep(
            step="tcp_connect", success=True,
            message=f"TCP port {server.ssh_port} reachable",
            elapsed_ms=int((_time.monotonic() - t0) * 1000),
        ))
    except Exception as exc:
        steps.append(SSHTestStep(
            step="tcp_connect", success=False, message=str(exc),
            elapsed_ms=int((_time.monotonic() - t0) * 1000),
        ))
        return SSHTestResponse(success=False, message="TCP connection failed", steps=steps)

    # Step 2 — SSH authentication
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_kwargs: dict = {
        "hostname": server.hostname,
        "port": server.ssh_port,
        "username": server.ssh_username,
        "timeout": 10,
    }
    if server.ssh_private_key:
        try:
            connect_kwargs["pkey"] = _load_pkey_from_content(server.ssh_private_key)
        except Exception as exc:
            steps.append(SSHTestStep(step="auth", success=False, message=f"Invalid key: {exc}", elapsed_ms=0))
            return SSHTestResponse(success=False, message="Invalid private key", steps=steps)
    elif server.ssh_password:
        connect_kwargs["password"] = server.ssh_password

    t0 = _time.monotonic()
    try:
        client.connect(**connect_kwargs)
        steps.append(SSHTestStep(
            step="auth", success=True,
            message=f"Authenticated as {server.ssh_username}",
            elapsed_ms=int((_time.monotonic() - t0) * 1000),
        ))
    except Exception as exc:
        steps.append(SSHTestStep(
            step="auth", success=False, message=str(exc),
            elapsed_ms=int((_time.monotonic() - t0) * 1000),
        ))
        return SSHTestResponse(success=False, message="Authentication failed", steps=steps)

    # Step 3 — Execute echo
    t0 = _time.monotonic()
    try:
        _, stdout, stderr = client.exec_command("echo ok", timeout=5)
        rc = stdout.channel.recv_exit_status()
        exec_ms = int((_time.monotonic() - t0) * 1000)
        if rc == 0:
            steps.append(SSHTestStep(step="exec_echo", success=True, message="echo ok → exit 0", elapsed_ms=exec_ms))
        else:
            err = stderr.read().decode(errors="replace").strip()
            steps.append(SSHTestStep(step="exec_echo", success=False, message=err or f"exit {rc}", elapsed_ms=exec_ms))
            client.close()
            return SSHTestResponse(success=False, message="Command execution failed", steps=steps)
    except Exception as exc:
        steps.append(SSHTestStep(
            step="exec_echo", success=False, message=str(exc),
            elapsed_ms=int((_time.monotonic() - t0) * 1000),
        ))
        client.close()
        return SSHTestResponse(success=False, message="Command execution failed", steps=steps)
    finally:
        client.close()

    # Promote status if requested (S3)
    promoted = False
    if promote_if_reachable and server.status in (ServerStatus.PROVISIONING, ServerStatus.FAILED):
        server.status = ServerStatus.READY
        db.commit()
        promoted = True

    done_msg = "All checks passed" + (" — promoted to READY" if promoted else "")
    steps.append(SSHTestStep(step="done", success=True, message=done_msg, elapsed_ms=0))
    return SSHTestResponse(success=True, message="Connection successful", steps=steps)


@router.post("/{server_id}/ssh/exec", response_model=ExecResponse, status_code=202)
def exec_ssh_command(
    server_id: UUID,
    body: ExecRequest,
    db: Session = Depends(get_db),
) -> ExecResponse:
    """Dispatch an SSH command as an async Celery task; returns the task_run_id to poll."""
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    task_run = TaskRun(
        task_type="ssh.execute_command",
        status=TaskStatus.PENDING,
        server_id=server.id,
        metadata_json={"command": body.command},
    )
    db.add(task_run)
    db.commit()
    db.refresh(task_run)

    from app.workers.tasks import execute_ssh_command
    execute_ssh_command.delay(str(task_run.id))

    return ExecResponse(task_run_id=str(task_run.id))
