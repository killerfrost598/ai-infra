"""Celery task for running inference benchmarks against a deployed model."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

from app.db.session import SessionLocal
from app.models.entities import (
    InferenceBenchmark,
    ModelDeployment,
    Server,
    TaskRun,
    TaskStatus,
)
from app.workers.celery_app import celery_app
from app.workers.tasks import _finish_task_run, _log_path, _make_logger, _utcnow

logger = logging.getLogger(__name__)


def _ssh_vram_sample(server: Server) -> float | None:
    """Sample GPU VRAM usage via SSH. Returns GB used or None."""
    from app.services.ssh_manager import SSHManager
    try:
        with SSHManager(
            hostname=server.hostname,
            port=server.ssh_port,
            username=server.ssh_username,
            password=server.ssh_password,
            private_key_content=server.ssh_private_key,
        ) as ssh:
            stdout, _, rc = ssh.execute(
                "nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1"
            )
            if rc == 0 and stdout.strip():
                used_mib = float(stdout.strip().splitlines()[0])
                return round(used_mib / 1024, 2)
    except Exception:
        pass
    return None


@celery_app.task(bind=True, name="benchmarks.run")
def run_benchmark(self, deployment_id: str, profile: str = "default") -> dict:
    """Run an inference benchmark against a deployed model's OpenAI-compatible endpoint."""
    from app.services.benchmark.runner import _wait_ready
    from app.services.benchmark.runner import run_benchmark as _run

    db = SessionLocal()
    try:
        deployment = db.query(ModelDeployment).filter(ModelDeployment.id == UUID(deployment_id)).first()
        if not deployment:
            return {"status": "failed", "error": "Deployment not found"}

        if not deployment.inference_base_url:
            return {"status": "failed", "error": "inference_base_url not set on deployment"}

        server = db.query(Server).filter(Server.id == deployment.server_id).first()
        if not server:
            return {"status": "failed", "error": "Server not found"}

        task_run = TaskRun(
            task_type="benchmarks.run",
            status=TaskStatus.RUNNING,
            server_id=server.id,
            model_deployment_id=deployment.id,
            started_at=_utcnow(),
            metadata_json={"deployment_id": deployment_id, "profile": profile},
        )
        db.add(task_run)
        db.commit()

        log_file = _log_path(str(task_run.id))
        task_run.logs_path = log_file
        db.commit()

        base_url = deployment.inference_base_url.rstrip("/")
        model = deployment.model_name

        with open(log_file, "w") as log_f:
            _log = _make_logger(log_f)
            _log(f"[benchmark] deployment={deployment_id} profile={profile}\n")
            _log(f"[benchmark] endpoint={base_url} model={model}\n\n")
            try:
                # Measure cold start
                _log("[benchmark] waiting for model API to respond...\n")
                cold_start = asyncio.run(_wait_ready(base_url, model, timeout_s=300))
                _log(f"[benchmark] cold start: {cold_start}s\n\n")

                # Run benchmark
                _log(f"[benchmark] running {profile} profile...\n")
                result = asyncio.run(_run(base_url, model, profile))
                _log(f"[benchmark] tps_avg={result.tps_avg:.1f} ttft_p95={result.ttft_p95:.0f}ms knee={result.knee_concurrency}\n")

                # VRAM sample
                vram = _ssh_vram_sample(server)
                _log(f"[benchmark] vram_used={vram}GB\n")

                # Persist
                now = datetime.now(tz=timezone.utc)
                benchmark = InferenceBenchmark(
                    gpu_model=server.gpu_model or "unknown",
                    gpu_vram_gb=server.vram_gb,
                    model_name=model,
                    model_family=None,
                    quantization=deployment.quantization,
                    tokens_per_second_avg=result.tps_avg,
                    tokens_per_second_p95=result.tps_p95,
                    ttft_ms_p50=result.ttft_p50,
                    ttft_ms_p95=result.ttft_p95,
                    prefill_tokens_per_second=result.prefill_tps,
                    cold_start_seconds=cold_start,
                    concurrency_curve=[
                        {"n": p.n, "agg_tps": p.agg_tps, "per_req_tps": p.per_req_tps, "p95_ttft_ms": p.p95_ttft_ms}
                        for p in result.concurrency_curve
                    ],
                    knee_concurrency=result.knee_concurrency,
                    max_parallel_connections=result.knee_concurrency,
                    vram_used_gb=vram,
                    profile=profile,
                    deployment_id=deployment.id,
                    task_run_id=task_run.id,
                    measured_at=now,
                )
                db.add(benchmark)
                task_run.status = TaskStatus.SUCCESS
                db.commit()
                _log(f"\n[benchmark complete] id={benchmark.id}\n")

            except Exception as exc:
                logger.exception("Benchmark failed for deployment %s", deployment_id)
                task_run.status = TaskStatus.FAILED
                task_run.error_summary = str(exc)
                _log(f"\nERROR: {exc}\n")

        _finish_task_run(task_run, db)
        return {"status": task_run.status.value, "deployment_id": deployment_id}

    finally:
        db.close()
