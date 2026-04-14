from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import Server, TaskRun, TaskStatus
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

class SSHTestResponse(BaseModel):
    success: bool
    message: str


class ExecRequest(BaseModel):
    command: str


class ExecResponse(BaseModel):
    task_run_id: str


@router.post("/{server_id}/ssh/test", response_model=SSHTestResponse)
def test_ssh_connection(server_id: UUID, db: Session = Depends(get_db)) -> SSHTestResponse:
    """Test SSH connectivity to a server (synchronous, 15 s timeout)."""
    server = db.query(Server).filter(Server.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    from app.services.ssh_manager import SSHManager

    try:
        with SSHManager(
            hostname=server.hostname,
            port=server.ssh_port,
            username=server.ssh_username,
            password=server.ssh_password,
            private_key_content=server.ssh_private_key,
            timeout=15,
        ) as ssh:
            stdout, stderr, rc = ssh.execute("echo ok")
        if rc == 0:
            return SSHTestResponse(success=True, message="Connection successful")
        return SSHTestResponse(success=False, message=stderr.strip() or f"exit code {rc}")
    except Exception as exc:
        return SSHTestResponse(success=False, message=str(exc))


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
