"""Celery tasks for server provisioning, model deployment, termination, and SSH command execution."""

from __future__ import annotations

import logging
import time
from uuid import UUID

from app.db.session import SessionLocal
from app.models.entities import (
    DeploymentStatus,
    EngineKind,
    HostCapabilitySnapshot,
    ModelDeployment,
    ModelVariant,
    Server,
    ServerStatus,
    TaskRun,
    TaskStatus,
)
from app.services.clore_client import CloreClient
from app.services.compat.probe import probe_host
from app.services.ssh_manager import SSHManager
from app.workers.celery_app import celery_app
from app.workers.utils import _finish_task_run, _log_path, _make_logger, _utcnow

logger = logging.getLogger(__name__)


# ── provision_server ──────────────────────────────────────────────────────────

def _create_snapshot(server: Server, probe_result, db) -> HostCapabilitySnapshot:
    snapshot = HostCapabilitySnapshot(
        server_id=server.id,
        driver_version=probe_result.driver_version,
        cuda_runtime_host=probe_result.cuda_runtime_host,
        gpu_count=len(probe_result.gpus),
        gpus=probe_result.gpus,
        nvlink_topology=probe_result.nvlink_topology,
        homogeneous=probe_result.homogeneous,
        docker_present=probe_result.docker_present,
        nvidia_container_toolkit=probe_result.nvidia_container_toolkit,
        raw_outputs=probe_result.raw_outputs,
    )
    db.add(snapshot)
    return snapshot


@celery_app.task(bind=True, name="servers.provision")
def provision_server(self, server_id: str) -> dict:
    """SSH into a server, probe GPU capabilities, and create a HostCapabilitySnapshot."""
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
                    _log("$ Running capability probe...\n")
                    result = probe_host(ssh)
                    _log(f"  Driver:  {result.driver_version or '(not detected)'}\n")
                    _log(f"  GPUs:    {len(result.gpus)}\n")
                    for g in result.gpus:
                        _log(f"    - {g['name']}  CC={g['cc']}  VRAM={g['vram_mb']} MB\n")
                    _log(f"  CUDA:    {result.cuda_runtime_host or '(not detected)'}\n")
                    _log(f"  Docker:  {result.docker_present}  (nvidia-ct: {result.nvidia_container_toolkit})\n")

                    _create_snapshot(server, result, db)

                    # B3 fix — only overwrite Server fields when probe returned real data
                    if result.gpus:
                        first = result.gpus[0]
                        if first.get("name"):
                            server.gpu_model = first["name"]
                        if first.get("vram_mb"):
                            server.vram_gb = first["vram_mb"] // 1024
                    if result.cuda_runtime_host:
                        server.cuda_version = result.cuda_runtime_host
                    if result.mem_total_gb:
                        server.ram_gb = result.mem_total_gb
                    if result.os_pretty_name:
                        server.os_image = result.os_pretty_name

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


@celery_app.task(bind=True, name="servers.reprobe")
def reprobe_server(self, server_id: str) -> dict:
    """Re-run capability probe on an already-provisioned server and create a fresh snapshot."""
    db = SessionLocal()
    try:
        server = db.query(Server).filter(Server.id == UUID(server_id)).first()
        if not server:
            return {"status": "failed", "error": "Server not found"}

        task_run = TaskRun(
            task_type="servers.reprobe",
            status=TaskStatus.RUNNING,
            server_id=server.id,
            started_at=_utcnow(),
        )
        db.add(task_run)
        db.commit()

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
                    _log("$ Running capability probe (reprobe)...\n")
                    result = probe_host(ssh)
                    _log(f"  Driver:  {result.driver_version or '(not detected)'}\n")
                    _log(f"  GPUs:    {len(result.gpus)}\n")
                    for g in result.gpus:
                        _log(f"    - {g['name']}  CC={g['cc']}  VRAM={g['vram_mb']} MB\n")
                    _log(f"  CUDA:    {result.cuda_runtime_host or '(not detected)'}\n")
                    _log(f"  Docker:  {result.docker_present}  (nvidia-ct: {result.nvidia_container_toolkit})\n")

                    _create_snapshot(server, result, db)

                    # Only update Server fields if probe returned real data (B3 fix applies here too)
                    if result.gpus:
                        first = result.gpus[0]
                        if first.get("name"):
                            server.gpu_model = first["name"]
                        if first.get("vram_mb"):
                            server.vram_gb = first["vram_mb"] // 1024
                    if result.cuda_runtime_host:
                        server.cuda_version = result.cuda_runtime_host
                    if result.mem_total_gb:
                        server.ram_gb = result.mem_total_gb
                    if result.os_pretty_name:
                        server.os_image = result.os_pretty_name

                task_run.status = TaskStatus.SUCCESS
                _log("\n[reprobe complete]\n")

            except Exception as exc:
                logger.exception("Reprobe failed for server %s", server_id)
                task_run.status = TaskStatus.FAILED
                task_run.error_summary = str(exc)
                _log(f"\nERROR: {exc}\n")

        _finish_task_run(task_run, db)
        return {"status": task_run.status.value, "server_id": server_id, "task_run_id": str(task_run.id)}

    finally:
        db.close()


# ── deploy_model ──────────────────────────────────────────────────────────────

@celery_app.task(bind=True, name="deployments.deploy")
def deploy_model(self, deployment_id: str) -> dict:
    """Deploy a model using select_stack(): container-first, venv fallback, health-gated."""
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
                # ── 1. Load snapshot (required) ──────────────────────────────
                snapshot = (
                    db.query(HostCapabilitySnapshot)
                    .filter(HostCapabilitySnapshot.server_id == server.id)
                    .order_by(HostCapabilitySnapshot.captured_at.desc())
                    .first()
                )
                if not snapshot:
                    raise RuntimeError("No capability snapshot — run reprobe before deploying")

                # ── 2. Load variant (optional) ───────────────────────────────
                variant: ModelVariant | None = None
                if deployment.model_variant_id:
                    variant = db.query(ModelVariant).filter(
                        ModelVariant.id == deployment.model_variant_id
                    ).first()

                engine = deployment.engine or EngineKind.VLLM
                tp_size = (deployment.install_plan_json or {}).get("tp_size", 1)

                # ── 3. Re-run feasibility (abort on BLOCKED) ─────────────────
                from app.services.compat.feasibility import run_feasibility
                model_key = variant.model_key if variant else deployment.model_name
                quant = variant.quant if variant else (deployment.quantization or "auto")
                gpu_name = snapshot.gpus[0].get("name") if snapshot.gpus else None
                vram_gb_total = (
                    sum(g.get("vram_gb", 0) for g in snapshot.gpus) if snapshot.gpus else None
                )

                _log("$ Feasibility check...\n")
                report = run_feasibility(
                    db=db,
                    gpu_name=gpu_name,
                    vram_gb_total=vram_gb_total,
                    gpu_count=snapshot.gpu_count,
                    driver_version=snapshot.driver_version,
                    snapshot=snapshot,
                    model_key=model_key,
                    quant=quant,
                    engine=engine.value,
                    tp_size=tp_size,
                )
                for check in report.checks:
                    _log(f"  [{check.status:7s}] {check.id}: {check.reason}\n")
                _log(f"  verdict={report.verdict}  mode={report.mode}\n\n")

                if report.verdict == "BLOCKED":
                    blocked = [c.reason for c in report.checks if c.status == "FAIL"]
                    raise RuntimeError(f"Feasibility BLOCKED — {'; '.join(blocked)}")

                # ── 4. Select stack ──────────────────────────────────────────
                if variant is None:
                    raise RuntimeError(
                        "model_variant_id is required for automatic stack selection — "
                        "set model_variant_id on the deployment or use the legacy flow"
                    )

                from app.services.compat.selector import select_stack
                from app.services.settings_service import get_setting
                hf_token = get_setting("hf_token", db)

                _log("$ Selecting stack...\n")
                plan = select_stack(
                    snapshot=snapshot,
                    variant=variant,
                    engine=engine,
                    db=db,
                    tp_size=tp_size,
                    remote_port=deployment.remote_port,
                    hf_token=hf_token,
                )
                _log(f"  mode={plan.mode}  stack_matrix_id={plan.stack_matrix_id}\n")
                if plan.container_image:
                    _log(f"  image={plan.container_image}\n")
                _log(f"  cmd={plan.launch_cmd[:120]}\n\n")

                deployment.stack_matrix_id = plan.stack_matrix_id
                deployment.install_plan_json = plan.to_dict()
                db.commit()

                # ── 5. SSH: install + launch ─────────────────────────────────
                with SSHManager(
                    hostname=server.hostname,
                    port=server.ssh_port,
                    username=server.ssh_username,
                    password=server.ssh_password,
                    private_key_content=server.ssh_private_key,
                    timeout=600,
                ) as ssh:
                    if plan.mode == "venv":
                        _log("$ Setting up venv...\n")
                        venv_cmd = (
                            "mkdir -p ~/.inferix/venvs && "
                            "uv venv ~/.inferix/venvs/deploy --python python3 2>&1 "
                            "|| python3 -m venv ~/.inferix/venvs/deploy"
                        )
                        stdout, stderr, rc = ssh.execute(venv_cmd)
                        _log(stdout)
                        if rc != 0:
                            raise RuntimeError(f"venv creation failed (exit {rc}): {stderr.strip()}")

                        if plan.packages:
                            packages_str = " ".join(plan.packages)
                            pip_extra = (
                                f"--extra-index-url {plan.pip_index_url} "
                                if plan.pip_index_url else ""
                            )
                            pip_cmd = (
                                f"~/.inferix/venvs/deploy/bin/pip install {pip_extra}{packages_str} 2>&1"
                            )
                            _log(f"$ pip install {packages_str}\n")
                            stdout, stderr, rc = ssh.execute(pip_cmd)
                            # Tail large output to avoid huge logs
                            _log(stdout[-3000:] if len(stdout) > 3000 else stdout)
                            if rc != 0:
                                raise RuntimeError(
                                    f"pip install failed (exit {rc}): {stderr.strip()[-500:]}"
                                )

                    elif plan.mode == "container" and plan.container_image:
                        pull_cmd = f"docker pull {plan.container_image}"
                        _log(f"$ {pull_cmd}\n")
                        stdout, stderr, rc = ssh.execute(pull_cmd)
                        _log(stdout[-3000:] if len(stdout) > 3000 else stdout)
                        if rc != 0:
                            raise RuntimeError(
                                f"docker pull failed (exit {rc}): {stderr.strip()[-500:]}"
                            )

                    # Launch (container -d or nohup &)
                    _log(f"\n$ {plan.launch_cmd}\n")
                    stdout, stderr, rc = ssh.execute(plan.launch_cmd)
                    _log(stdout)
                    if stderr:
                        _log(f"  stderr: {stderr[:500]}\n")
                    if rc != 0:
                        raise RuntimeError(f"Launch failed (exit {rc}): {stderr.strip()}")

                    # ── 6. Health poll: 60×2s = 120s ────────────────────────
                    _log("\n$ Waiting for /v1/models health check...\n")
                    poll_cmd = (
                        f"timeout 3 curl -s -o /dev/null "
                        f"-w '%{{http_code}}' "
                        f"http://localhost:{plan.remote_port}/v1/models"
                    )
                    healthy = False
                    for attempt in range(60):
                        time.sleep(2)
                        try:
                            stdout, _, poll_rc = ssh.execute(poll_cmd)
                            code = stdout.strip()
                            if code == "200":
                                healthy = True
                                _log(f"  [attempt {attempt + 1}] HTTP 200 — healthy!\n")
                                break
                            if attempt % 5 == 0:
                                _log(f"  [attempt {attempt + 1}] HTTP {code or '?'} — waiting...\n")
                        except Exception as poll_err:
                            if attempt % 5 == 0:
                                _log(f"  [attempt {attempt + 1}] poll error: {poll_err}\n")

                    if not healthy:
                        raise RuntimeError(
                            "vLLM did not become healthy within 120 seconds"
                        )

                # ── 7. Mark success ──────────────────────────────────────────
                deployment.inference_base_url = (
                    f"http://{server.hostname}:{plan.remote_port}/v1"
                )
                deployment.status = DeploymentStatus.RUNNING
                deployment.started_at = _utcnow()
                task_run.status = TaskStatus.SUCCESS
                _log(f"\n[deployment ready] {deployment.inference_base_url}\n")

                if get_setting("auto_benchmark", db) == "true":
                    from app.workers.benchmark_tasks import run_benchmark as _bench_task
                    _bench_task.delay(str(deployment.id), profile="default")

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

        try:
            from app.models.entities import PlaybookRunOutcome
            outcome = PlaybookRunOutcome(
                playbook_id=playbook.id,
                task_run_id=task_run.id,
                server_id=server.id,
                model_variant_id=getattr(playbook, "model_variant_id", None),
                gpu_model=server.gpu_model,
                succeeded=(task_run.status == TaskStatus.SUCCESS),
                duration_seconds=task_run.duration_seconds,
            )
            db.add(outcome)
            db.commit()
        except Exception:
            logger.warning("Failed to insert PlaybookRunOutcome for playbook %s", playbook_id, exc_info=True)

        return {"status": task_run.status.value, "server_id": server_id, "playbook_id": playbook_id}

    finally:
        db.close()


# ── compat.scrape_versions ────────────────────────────────────────────────────

def _version_newer(latest: str, current: str) -> bool:
    try:
        def _parse(v: str) -> tuple[int, ...]:
            return tuple(int(x) for x in v.split(".")[:3])
        return _parse(latest) > _parse(current)
    except Exception:
        return latest != current


@celery_app.task(bind=True, name="compat.scrape_versions")
def scrape_versions(self) -> dict:
    """Check PyPI for newer vLLM / SGLang versions and record candidates."""
    import httpx

    from app.models.entities import StackMatrix

    db = SessionLocal()
    task_run = TaskRun(task_type="compat.scrape_versions", status=TaskStatus.RUNNING, started_at=_utcnow())
    try:
        db.add(task_run)
        db.commit()
        db.refresh(task_run)

        candidates: list[dict] = []
        for engine in ("vllm", "sglang"):
            try:
                resp = httpx.get(f"https://pypi.org/pypi/{engine}/json", timeout=15)
                resp.raise_for_status()
                latest_version: str = resp.json()["info"]["version"]
                all_active = db.query(StackMatrix).filter(StackMatrix.is_active == True).all()  # noqa: E712
                versions = (
                    [r.vllm for r in all_active if r.vllm]
                    if engine == "vllm"
                    else [r.sglang for r in all_active if r.sglang]
                )
                current_version = (
                    max(versions, key=lambda v: tuple(int(x) for x in v.split(".")[:3]))
                    if versions
                    else None
                )
                is_newer = _version_newer(latest_version, current_version) if current_version else True
                candidates.append({
                    "engine": engine,
                    "latest_version": latest_version,
                    "current_version": current_version,
                    "is_newer": is_newer,
                })
            except Exception as exc:
                candidates.append({"engine": engine, "error": str(exc), "is_newer": False})

        task_run.status = TaskStatus.SUCCESS
        task_run.metadata_json = {"candidates": candidates}
        _finish_task_run(task_run, db)
        return {"candidates": candidates}
    except Exception as exc:
        task_run.status = TaskStatus.FAILED
        task_run.error_summary = str(exc)
        _finish_task_run(task_run, db)
        raise
    finally:
        db.close()


# ── HF model seeder tasks ─────────────────────────────────────────────────────

@celery_app.task(bind=True, name="models.seed_one")
def seed_model_from_hf(self, repo_id: str) -> dict:
    """Fetch a single HF repo and upsert it into the models + model_quants tables."""
    from app.services.hf_seeder import seed_one_repo

    db = SessionLocal()
    task_run = TaskRun(
        task_type="models.seed_one",
        status=TaskStatus.RUNNING,
        started_at=_utcnow(),
        metadata_json={"repo_id": repo_id},
    )
    try:
        db.add(task_run)
        db.commit()

        model = seed_one_repo(repo_id, db=db)

        task_run.status = TaskStatus.SUCCESS
        task_run.metadata_json = {
            "repo_id": repo_id,
            "model_id": str(model.id),
            "quant_count": len(model.quants),
        }
        _finish_task_run(task_run, db)
        return {"status": "success", "repo_id": repo_id, "task_run_id": str(task_run.id)}

    except Exception as exc:
        logger.exception("seed_model_from_hf failed for %s", repo_id)
        task_run.status = TaskStatus.FAILED
        task_run.error_summary = str(exc)
        _finish_task_run(task_run, db)
        return {"status": "failed", "repo_id": repo_id, "error": str(exc)}

    finally:
        db.close()


@celery_app.task(bind=True, name="models.seed_all")
def seed_all_models(self) -> dict:
    """Re-seed every model with source='hf' from HuggingFace."""
    from app.models.entities import Model as ModelEntity
    from app.services.hf_seeder import seed_one_repo

    db = SessionLocal()
    task_run = TaskRun(
        task_type="models.seed_all",
        status=TaskStatus.RUNNING,
        started_at=_utcnow(),
    )
    try:
        db.add(task_run)
        db.commit()

        repo_ids = [
            m.model_key
            for m in db.query(ModelEntity)
            .filter(ModelEntity.source == "hf", ModelEntity.is_archived == False)  # noqa: E712
            .all()
        ]

        succeeded = 0
        failed_repos: list[dict] = []
        for repo_id in repo_ids:
            try:
                seed_one_repo(repo_id, db=db)
                succeeded += 1
            except Exception as exc:
                logger.warning("seed_all_models: %s failed: %s", repo_id, exc)
                failed_repos.append({"repo_id": repo_id, "error": str(exc)})

        failed = len(failed_repos)
        if failed == 0:
            task_run.status = TaskStatus.SUCCESS
        elif succeeded > 0:
            task_run.status = TaskStatus.PARTIAL
        else:
            task_run.status = TaskStatus.FAILED

        task_run.metadata_json = {
            "total": len(repo_ids),
            "succeeded": succeeded,
            "failed": failed,
            "errors": failed_repos[:20],
        }
        _finish_task_run(task_run, db)
        return {
            "status": task_run.status.value,
            "total": len(repo_ids),
            "succeeded": succeeded,
            "failed": failed,
        }

    except Exception as exc:
        logger.exception("seed_all_models task failed")
        task_run.status = TaskStatus.FAILED
        task_run.error_summary = str(exc)
        _finish_task_run(task_run, db)
        return {"status": "failed", "error": str(exc)}

    finally:
        db.close()
