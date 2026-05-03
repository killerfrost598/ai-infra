"""Celery tasks for server provisioning, model deployment, termination, and SSH command execution."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import IO
from uuid import UUID

from app.db.session import SessionLocal
from app.models.entities import (
    DeploymentStatus,
    ModelDeployment,
    Server,
    ServerStatus,
    TaskRun,
    TaskStatus,
)
from app.services.clore_client import CloreClient
from app.services.ssh_manager import SSHManager
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

LOG_DIR = "/var/log/aip"


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


def _log_path(task_run_id: str) -> str:
    os.makedirs(LOG_DIR, exist_ok=True)
    return os.path.join(LOG_DIR, f"{task_run_id}.log")


def _make_logger(log_f: IO[str]):
    """Return a callable that writes text to an open log file and flushes immediately."""
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


# ── provision_server ──────────────────────────────────────────────────────────

@celery_app.task(bind=True, name="servers.provision")
def provision_server(self, server_id: str) -> dict:
    """SSH into a server, run nvidia-smi, and extract GPU capabilities."""
    db = SessionLocal()
    try:
        server = db.query(Server).filter(Server.id == UUID(server_id)).first()
        if not server:
            return {"status": "failed", "error": "Server not found"}

        task_run = TaskRun(
            task_type="servers.provision",
            status=TaskStatus.RUNNING,
            server_id=server.id,
            started_at=_utcnow(),
        )
        db.add(task_run)
        server.status = ServerStatus.PROVISIONING
        db.commit()

        # Set logs_path before starting so SSE can find the file immediately
        log_file = _log_path(str(task_run.id))
        task_run.logs_path = log_file
        db.commit()

        with open(log_file, "w") as log_f:
            _log = _make_logger(log_f)
            try:
                with SSHManager(
                    hostname=server.hostname,
                    port=server.ssh_port,
                    username=server.ssh_username,
                    password=server.ssh_password,
                    private_key_content=server.ssh_private_key,
                ) as ssh:
                    cmd = "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader"
                    _log(f"$ {cmd}\n")
                    stdout, stderr, rc = ssh.execute(cmd)
                    _log(stdout)
                    if rc == 0 and stdout.strip():
                        try:
                            line = stdout.strip().splitlines()[0]
                            gpu_name, vram_str = line.split(",", 1)
                            server.gpu_model = gpu_name.strip()
                            server.vram_gb = int(vram_str.strip().split()[0]) // 1024
                        except (ValueError, IndexError):
                            pass
                    else:
                        _log(f"(nvidia-smi not available: {stderr.strip() or 'command not found'} — skipping GPU detection)\n")

                    cmd2 = "nvcc --version 2>/dev/null | grep release | awk '{print $6}' | cut -c2-"
                    _log(f"\n$ {cmd2}\n")
                    stdout2, _, rc2 = ssh.execute(cmd2)
                    _log(stdout2)
                    if rc2 == 0 and stdout2.strip():
                        server.cuda_version = stdout2.strip()

                server.status = ServerStatus.READY
                task_run.status = TaskStatus.SUCCESS
                _log("\n[provisioning complete]\n")

            except Exception as exc:
                logger.exception("Provisioning failed for server %s", server_id)
                server.status = ServerStatus.FAILED
                task_run.status = TaskStatus.FAILED
                task_run.error_summary = str(exc)
                _log(f"\nERROR: {exc}\n")

        _finish_task_run(task_run, db)
        return {"status": task_run.status.value, "server_id": server_id}

    finally:
        db.close()


# ── deploy_model ──────────────────────────────────────────────────────────────

@celery_app.task(bind=True, name="deployments.deploy")
def deploy_model(self, deployment_id: str) -> dict:
    """Launch vLLM via Docker on the target server."""
    db = SessionLocal()
    try:
        deployment = db.query(ModelDeployment).filter(ModelDeployment.id == UUID(deployment_id)).first()
        if not deployment:
            return {"status": "failed", "error": "Deployment not found"}

        server = db.query(Server).filter(Server.id == deployment.server_id).first()
        if not server:
            return {"status": "failed", "error": "Server not found"}

        task_run = TaskRun(
            task_type="deployments.deploy",
            status=TaskStatus.RUNNING,
            server_id=server.id,
            model_deployment_id=deployment.id,
            started_at=_utcnow(),
        )
        db.add(task_run)
        deployment.status = DeploymentStatus.DEPLOYING
        db.commit()

        log_file = _log_path(str(task_run.id))
        task_run.logs_path = log_file
        db.commit()

        with open(log_file, "w") as log_f:
            _log = _make_logger(log_f)
            try:
                cmd = (
                    f"docker run -d --gpus all --rm "
                    f"-p {deployment.remote_port}:{deployment.remote_port} "
                    f"vllm/vllm-openai:latest "
                    f"--model {deployment.model_name} "
                    f"--port {deployment.remote_port}"
                )
                if deployment.quantization:
                    cmd += f" --quantization {deployment.quantization}"

                _log(f"$ {cmd}\n")
                with SSHManager(
                    hostname=server.hostname,
                    port=server.ssh_port,
                    username=server.ssh_username,
                    password=server.ssh_password,
                    private_key_content=server.ssh_private_key,
                ) as ssh:
                    stdout, stderr, rc = ssh.execute(cmd)
                    _log(stdout)
                    if stderr:
                        _log(f"\n--- stderr ---\n{stderr}\n")
                    if rc != 0:
                        raise RuntimeError(f"vLLM launch failed (exit {rc}): {stderr.strip()}")

                deployment.status = DeploymentStatus.RUNNING
                deployment.started_at = _utcnow()
                task_run.status = TaskStatus.SUCCESS

                # Auto-benchmark if enabled and inference_base_url is set
                from app.services.settings_service import get_setting
                if (
                    get_setting("auto_benchmark", db) == "true"
                    and deployment.inference_base_url
                ):
                    from app.workers.benchmark_tasks import run_benchmark as _bench_task
                    _bench_task.delay(str(deployment.id), profile="default")

                _log("\n[vLLM container started]\n")

            except Exception as exc:
                logger.exception("Deployment failed for deployment %s", deployment_id)
                deployment.status = DeploymentStatus.FAILED
                task_run.status = TaskStatus.FAILED
                task_run.error_summary = str(exc)
                _log(f"\nERROR: {exc}\n")

        _finish_task_run(task_run, db)
        return {"status": task_run.status.value, "deployment_id": deployment_id}

    finally:
        db.close()


# ── terminate_server ──────────────────────────────────────────────────────────

@celery_app.task(bind=True, name="servers.terminate")
def terminate_server(self, server_id: str) -> dict:
    """Terminate a Clore.ai rental and mark the server record as TERMINATED."""
    db = SessionLocal()
    try:
        server = db.query(Server).filter(Server.id == UUID(server_id)).first()
        if not server:
            return {"status": "failed", "error": "Server not found"}

        task_run = TaskRun(
            task_type="servers.terminate",
            status=TaskStatus.RUNNING,
            server_id=server.id,
            started_at=_utcnow(),
        )
        db.add(task_run)
        db.commit()

        from app.services.settings_service import get_setting

        try:
            clore_key = get_setting("clore_api_key", db)
            if not clore_key:
                raise RuntimeError("Clore API key not configured in settings")
            with CloreClient(clore_key) as client:
                client.terminate_rental(server.external_server_id)
            server.status = ServerStatus.TERMINATED
            task_run.status = TaskStatus.SUCCESS
        except Exception as exc:
            logger.exception("Termination failed for server %s", server_id)
            task_run.status = TaskStatus.FAILED
            task_run.error_summary = str(exc)
            _finish_task_run(task_run, db)
            return {"status": "failed", "error": str(exc)}

        _finish_task_run(task_run, db)
        return {"status": "success", "server_id": server_id}

    finally:
        db.close()


# ── execute_ssh_command ───────────────────────────────────────────────────────

@celery_app.task(bind=True, name="ssh.execute_command")
def execute_ssh_command(self, task_run_id: str) -> dict:
    """Run an arbitrary SSH command on a server and store stdout/stderr as a log file."""
    db = SessionLocal()
    try:
        task_run = db.query(TaskRun).filter(TaskRun.id == UUID(task_run_id)).first()
        if not task_run:
            return {"status": "failed", "error": "TaskRun not found"}

        server = db.query(Server).filter(Server.id == task_run.server_id).first()
        if not server:
            task_run.status = TaskStatus.FAILED
            task_run.error_summary = "Server not found"
            db.commit()
            return {"status": "failed", "error": "Server not found"}

        command = (task_run.metadata_json or {}).get("command", "")
        task_run.status = TaskStatus.RUNNING
        task_run.started_at = _utcnow()

        log_file = _log_path(task_run_id)
        task_run.logs_path = log_file
        db.commit()

        with open(log_file, "w") as log_f:
            _log = _make_logger(log_f)
            _log(f"$ {command}\n")
            try:
                with SSHManager(
                    hostname=server.hostname,
                    port=server.ssh_port,
                    username=server.ssh_username,
                    password=server.ssh_password,
                    private_key_content=server.ssh_private_key,
                ) as ssh:
                    stdout, stderr, rc = ssh.execute(command)

                _log(stdout)
                if stderr:
                    _log(f"\n--- stderr ---\n{stderr}")
                _log(f"\n--- exit code: {rc} ---\n")

                task_run.status = TaskStatus.SUCCESS if rc == 0 else TaskStatus.FAILED
                if rc != 0:
                    task_run.error_summary = f"Command exited with code {rc}"

            except Exception as exc:
                logger.exception("SSH command failed for task run %s", task_run_id)
                _log(f"\nERROR: {exc}\n")
                task_run.status = TaskStatus.FAILED
                task_run.error_summary = str(exc)

        _finish_task_run(task_run, db)
        return {"status": task_run.status.value, "task_run_id": task_run_id}

    finally:
        db.close()


# ── run_playbook ──────────────────────────────────────────────────────────────

@celery_app.task(bind=True, name="playbooks.run")
def run_playbook_task(self, server_id: str, playbook_id: str) -> dict:
    """Clone a playbook git repo on the server and execute its setup.sh."""
    from uuid import UUID as _UUID
    from app.models.entities import Playbook
    from app.services.playbook_runner import run_playbook

    db = SessionLocal()
    try:
        server = db.query(Server).filter(Server.id == _UUID(server_id)).first()
        if not server:
            return {"status": "failed", "error": "Server not found"}

        playbook = db.query(Playbook).filter(Playbook.id == _UUID(playbook_id)).first()
        if not playbook:
            return {"status": "failed", "error": "Playbook not found"}

        task_run = TaskRun(
            task_type="playbooks.run",
            status=TaskStatus.RUNNING,
            server_id=server.id,
            started_at=_utcnow(),
            metadata_json={"playbook_id": playbook_id},
        )
        db.add(task_run)
        db.commit()

        log_file = _log_path(str(task_run.id))
        task_run.logs_path = log_file
        db.commit()

        with open(log_file, "w") as log_f:
            _log = _make_logger(log_f)
            _log(f"[playbook] {playbook.name} → server {server.hostname}\n\n")
            try:
                success = run_playbook(server, playbook, _log)
                task_run.status = TaskStatus.SUCCESS if success else TaskStatus.FAILED
                if not success:
                    task_run.error_summary = "Playbook setup.sh exited with non-zero status"
                    _log("\n[FAILED]\n")
                else:
                    _log("\n[SUCCESS]\n")
            except Exception as exc:
                logger.exception("Playbook run failed server=%s playbook=%s", server_id, playbook_id)
                task_run.status = TaskStatus.FAILED
                task_run.error_summary = str(exc)
                _log(f"\nERROR: {exc}\n")

        _finish_task_run(task_run, db)
        return {"status": task_run.status.value, "server_id": server_id, "playbook_id": playbook_id}

    finally:
        db.close()
