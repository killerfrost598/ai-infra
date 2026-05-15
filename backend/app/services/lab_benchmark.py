"""Lab-native benchmark runner for the active SSH-backed vLLM endpoint."""

from __future__ import annotations

import json
import shlex
import statistics
import time
from datetime import datetime, timezone
from uuid import UUID

from app.db.session import SessionLocal
from app.models.entities import InferenceBenchmark, LabServerState, Model, ModelQuant, Server, TaskRun, TaskStatus
from app.services import session_store
from app.workers.utils import _finish_task_run, _log_path, _make_logger, _utcnow

PROFILE_REQUESTS = {"quick": 3, "default": 8, "thorough": 16}


def _exec(client, command: str, timeout: int = 180) -> tuple[str, str, int]:
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    stdin.close()
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    return out, err, rc


def _curl_chat_command(port: int, payload: dict) -> str:
    body = json.dumps(payload, separators=(",", ":"))
    return (
        "printf %s "
        f"{shlex.quote(body)} "
        f"| curl -sS --max-time 180 -w '\\n__TIME_TOTAL__:%{{time_total}}' "
        "-H 'Content-Type: application/json' -d @- "
        f"http://127.0.0.1:{int(port)}/v1/chat/completions"
    )


def _parse_curl_chat(out: str) -> tuple[dict | None, float | None]:
    marker = "\n__TIME_TOTAL__:"
    if marker not in out:
        return None, None
    raw_json, raw_time = out.rsplit(marker, 1)
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError:
        data = None
    try:
        latency_s = float(raw_time.strip().splitlines()[0])
    except (ValueError, IndexError):
        latency_s = None
    return data, latency_s


def _read_vram_used(client) -> float | None:
    out, _, rc = _exec(
        client,
        "nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null",
        timeout=20,
    )
    if rc != 0:
        return None
    total_mb = 0
    for line in out.splitlines():
        try:
            total_mb += int(line.strip())
        except ValueError:
            pass
    return round(total_mb / 1024, 2) if total_mb else None


def run_lab_active_benchmark_task(*, task_run_id: str, session_id: str, profile: str) -> None:
    db = SessionLocal()
    try:
        task_run = db.query(TaskRun).filter(TaskRun.id == UUID(task_run_id)).first()
        if not task_run:
            return
        task_run.status = TaskStatus.RUNNING
        task_run.started_at = _utcnow()
        log_file = _log_path(task_run_id)
        task_run.logs_path = log_file
        db.commit()

        server_id = task_run.server_id
        state = db.query(LabServerState).filter(LabServerState.server_id == server_id).first() if server_id else None
        server = db.query(Server).filter(Server.id == server_id).first() if server_id else None
        if not state or not state.active_model_repo or not state.active_port:
            raise RuntimeError("No active Lab model endpoint is recorded for this server")

        handle = session_store.get(session_id)
        if handle is None:
            raise RuntimeError("No active SSH handle for this session")

        model = db.query(Model).filter(Model.id == state.active_model_id).first() if state.active_model_id else None
        quant = db.query(ModelQuant).filter(ModelQuant.id == state.active_quant_id).first() if state.active_quant_id else None
        request_count = PROFILE_REQUESTS.get(profile, PROFILE_REQUESTS["quick"])
        payload = {
            "model": state.active_model_repo,
            "messages": [{"role": "user", "content": "Write one concise sentence about GPU inference."}],
            "max_tokens": 96,
            "temperature": 0.0,
        }

        latencies_ms: list[float] = []
        tps_values: list[float] = []
        usage_rows: list[dict] = []
        with open(log_file, "w", encoding="utf-8") as log_f:
            log = _make_logger(log_f)
            log(f"[benchmark] active Lab model={state.active_model_repo} profile={profile}\n")
            log(f"[benchmark] endpoint=http://127.0.0.1:{state.active_port}/v1/chat/completions\n\n")

            cold_t0 = time.monotonic()
            out, err, rc = _exec(
                handle.client,
                f"curl -sf --max-time 10 http://127.0.0.1:{int(state.active_port)}/v1/models >/dev/null",
                timeout=15,
            )
            cold_start = int(time.monotonic() - cold_t0) if rc == 0 else None
            if rc != 0:
                raise RuntimeError(err or out or "Active model health check failed")
            log(f"[benchmark] cold_start_seconds={cold_start}\n")

            for idx in range(request_count):
                out, err, rc = _exec(handle.client, _curl_chat_command(state.active_port, payload), timeout=210)
                if rc != 0:
                    log(f"[benchmark] request {idx + 1} failed: {err or out}\n")
                    continue
                data, latency_s = _parse_curl_chat(out)
                if latency_s is None or data is None:
                    log(f"[benchmark] request {idx + 1} returned an unparseable response\n")
                    continue
                usage = data.get("usage") if isinstance(data, dict) else None
                usage_rows.append(usage or {})
                completion_tokens = int((usage or {}).get("completion_tokens") or 0)
                if completion_tokens <= 0:
                    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "") if isinstance(data, dict) else ""
                    completion_tokens = max(1, len(text.split()))
                latency_ms = latency_s * 1000
                latencies_ms.append(latency_ms)
                tps = completion_tokens / max(latency_s, 0.001)
                tps_values.append(tps)
                log(f"[benchmark] request {idx + 1}: latency={latency_ms:.0f}ms completion_tokens={completion_tokens} tps={tps:.1f}\n")

            if not tps_values:
                raise RuntimeError("Benchmark produced no successful requests")

            latencies_ms.sort()
            tps_values.sort()
            vram = _read_vram_used(handle.client)
            benchmark = InferenceBenchmark(
                gpu_model=server.gpu_model if server and server.gpu_model else "unknown",
                gpu_vram_gb=server.vram_gb if server else None,
                model_name=state.active_model_repo,
                model_family=model.family if model else None,
                quantization=quant.name if quant else None,
                tokens_per_second_avg=statistics.mean(tps_values),
                tokens_per_second_p95=tps_values[int(len(tps_values) * 0.95)] if tps_values else None,
                ttft_ms_p50=latencies_ms[len(latencies_ms) // 2] if latencies_ms else None,
                ttft_ms_p95=latencies_ms[int(len(latencies_ms) * 0.95)] if latencies_ms else None,
                prefill_tokens_per_second=None,
                cold_start_seconds=cold_start,
                concurrency_curve=None,
                knee_concurrency=1,
                max_parallel_connections=1,
                vram_used_gb=vram,
                profile=f"lab-{profile}",
                task_run_id=task_run.id,
                measured_at=datetime.now(timezone.utc),
                notes=json.dumps({"active_profile": state.active_profile_json, "usage": usage_rows[-3:]}),
            )
            db.add(benchmark)
            db.flush()
            task_run.status = TaskStatus.SUCCESS
            task_run.metadata_json = {
                **(task_run.metadata_json or {}),
                "benchmark_id": str(benchmark.id),
                "model_name": state.active_model_repo,
            }
            db.commit()
            log(f"\n[benchmark complete] id={benchmark.id} avg_tps={benchmark.tokens_per_second_avg:.1f} vram={vram}GB\n")

    except Exception as exc:
        task_run = db.query(TaskRun).filter(TaskRun.id == UUID(task_run_id)).first()
        if task_run:
            task_run.status = TaskStatus.FAILED
            task_run.error_summary = str(exc)[:1000]
            db.commit()
            if task_run.logs_path:
                try:
                    with open(task_run.logs_path, "a", encoding="utf-8") as log_f:
                        log_f.write(f"\nERROR: {exc}\n")
                except Exception:
                    pass
    finally:
        task_run = db.query(TaskRun).filter(TaskRun.id == UUID(task_run_id)).first()
        if task_run:
            _finish_task_run(task_run, db)
        db.close()
