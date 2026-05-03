from __future__ import annotations

import asyncio
import json
import statistics
import time
from dataclasses import dataclass, field

import httpx

from .prompts import DEFAULT_MAX_TOKENS, PROMPT_LONG, PROMPT_SHORT, TTFT_MAX_TOKENS

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)


@dataclass
class CurvePoint:
    n: int
    agg_tps: float
    per_req_tps: float
    p95_ttft_ms: float


@dataclass
class BenchmarkResult:
    tps_avg: float
    tps_p95: float
    ttft_p50: float
    ttft_p95: float
    prefill_tps: float
    cold_start_seconds: int | None
    concurrency_curve: list[CurvePoint]
    knee_concurrency: int
    vram_used_gb: float | None = None


def _chat_payload(model: str, prompt: str, max_tokens: int, stream: bool = False) -> dict:
    return {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "stream": stream,
        "temperature": 0.0,
    }


async def _wait_ready(base_url: str, model: str, timeout_s: int = 300) -> int | None:
    """Ping until the API responds or timeout. Return cold-start seconds."""
    url = f"{base_url}/v1/chat/completions"
    payload = _chat_payload(model, "hi", max_tokens=1)
    t0 = time.monotonic()
    deadline = t0 + timeout_s
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
        while time.monotonic() < deadline:
            try:
                r = await client.post(url, json=payload)
                if r.status_code < 500:
                    return int(time.monotonic() - t0)
            except Exception:
                pass
            await asyncio.sleep(3.0)
    return None


async def _one_shot(client: httpx.AsyncClient, url: str, model: str, prompt: str, max_tokens: int) -> None:
    payload = _chat_payload(model, prompt, max_tokens)
    await client.post(url, json=payload)


async def _stream_first_token(client: httpx.AsyncClient, url: str, model: str, prompt: str, max_tokens: int) -> float:
    """Return TTFT in ms."""
    payload = _chat_payload(model, prompt, max_tokens, stream=True)
    t0 = time.monotonic()
    async with client.stream("POST", url, json=payload) as resp:
        async for line in resp.aiter_lines():
            if line.startswith("data:") and line != "data: [DONE]":
                return (time.monotonic() - t0) * 1000
    return (time.monotonic() - t0) * 1000


async def _stream_full(client: httpx.AsyncClient, url: str, model: str, prompt: str, max_tokens: int) -> tuple[float, float]:
    """Return (ttft_ms, decode_tps)."""
    payload = _chat_payload(model, prompt, max_tokens, stream=True)
    t0 = time.monotonic()
    ttft: float | None = None
    token_count = 0
    async with client.stream("POST", url, json=payload) as resp:
        async for line in resp.aiter_lines():
            if not line.startswith("data:") or line == "data: [DONE]":
                continue
            try:
                chunk = json.loads(line[6:])
                delta = chunk["choices"][0]["delta"].get("content", "")
                if delta:
                    if ttft is None:
                        ttft = (time.monotonic() - t0) * 1000
                    token_count += 1
            except Exception:
                pass
    elapsed = time.monotonic() - t0
    ttft_ms = ttft if ttft is not None else elapsed * 1000
    decode_elapsed = max(elapsed - ttft_ms / 1000, 0.001)
    decode_tps = token_count / decode_elapsed if decode_elapsed > 0 else 0.0
    return ttft_ms, decode_tps


async def _measure_prefill(client: httpx.AsyncClient, url: str, model: str) -> float:
    """Measure prefill tokens/sec using a long prompt."""
    payload = _chat_payload(model, PROMPT_LONG, max_tokens=1, stream=True)
    t0 = time.monotonic()
    input_tokens = len(PROMPT_LONG.split())  # rough approximation
    async with client.stream("POST", url, json=payload) as resp:
        async for _ in resp.aiter_lines():
            pass
    elapsed = max(time.monotonic() - t0, 0.001)
    return input_tokens / elapsed


async def _concurrency_round(client: httpx.AsyncClient, url: str, model: str, n: int, duration_s: int) -> CurvePoint:
    """Run N concurrent requests for `duration_s` seconds. Return aggregated stats."""
    deadline = time.monotonic() + duration_s
    ttfts: list[float] = []
    tps_samples: list[float] = []

    async def _worker() -> None:
        while time.monotonic() < deadline:
            try:
                ttft, tps = await _stream_full(client, url, model, PROMPT_SHORT, DEFAULT_MAX_TOKENS)
                ttfts.append(ttft)
                tps_samples.append(tps)
            except Exception:
                pass

    workers = [asyncio.create_task(_worker()) for _ in range(n)]
    await asyncio.gather(*workers, return_exceptions=True)

    if not tps_samples:
        return CurvePoint(n=n, agg_tps=0.0, per_req_tps=0.0, p95_ttft_ms=99999.0)

    ttfts.sort()
    p95_ttft = ttfts[int(len(ttfts) * 0.95)] if ttfts else 99999.0
    per_req_tps = statistics.mean(tps_samples)
    agg_tps = per_req_tps * n
    return CurvePoint(n=n, agg_tps=agg_tps, per_req_tps=per_req_tps, p95_ttft_ms=p95_ttft)


def _compute_knee(curve: list[CurvePoint]) -> int:
    if not curve:
        return 1
    baseline_tps = curve[0].per_req_tps if curve else 1.0
    for pt in curve:
        if pt.p95_ttft_ms > 5000 or (baseline_tps > 0 and pt.per_req_tps < baseline_tps * 0.5):
            return pt.n
    return curve[-1].n


PROFILE_CONFIG = {
    "quick":    {"warmup": 5,  "ttft_n": 10,  "tps_s": 15, "concurrencies": [1, 4, 8],               "conc_s": 15},
    "default":  {"warmup": 10, "ttft_n": 50,  "tps_s": 30, "concurrencies": [1, 2, 4, 8, 16, 32],    "conc_s": 30},
    "thorough": {"warmup": 20, "ttft_n": 100, "tps_s": 60, "concurrencies": [1, 2, 4, 8, 16, 32, 64], "conc_s": 60},
}


async def run_benchmark(base_url: str, model: str, profile: str = "default") -> BenchmarkResult:
    cfg = PROFILE_CONFIG.get(profile, PROFILE_CONFIG["default"])
    url = f"{base_url}/v1/chat/completions"

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        # 1. Warm-up
        for _ in range(cfg["warmup"]):
            try:
                await _one_shot(client, url, model, PROMPT_SHORT, max_tokens=64)
            except Exception:
                pass

        # 2. TTFT pass
        ttfts: list[float] = []
        for _ in range(cfg["ttft_n"]):
            try:
                ttft = await _stream_first_token(client, url, model, PROMPT_SHORT, TTFT_MAX_TOKENS)
                ttfts.append(ttft)
            except Exception:
                pass

        ttfts.sort()
        ttft_p50 = ttfts[len(ttfts) // 2] if ttfts else 0.0
        ttft_p95 = ttfts[int(len(ttfts) * 0.95)] if ttfts else 0.0

        # 3. Throughput
        tps_samples: list[float] = []
        end = time.monotonic() + cfg["tps_s"]
        while time.monotonic() < end:
            try:
                _, tps = await _stream_full(client, url, model, PROMPT_SHORT, DEFAULT_MAX_TOKENS)
                tps_samples.append(tps)
            except Exception:
                pass

        tps_samples.sort()
        tps_avg = statistics.mean(tps_samples) if tps_samples else 0.0
        tps_p95 = tps_samples[int(len(tps_samples) * 0.95)] if tps_samples else 0.0

        # 4. Prefill
        try:
            prefill_tps = await _measure_prefill(client, url, model)
        except Exception:
            prefill_tps = 0.0

        # 5. Concurrency sweep
        curve: list[CurvePoint] = []
        for n in cfg["concurrencies"]:
            try:
                pt = await _concurrency_round(client, url, model, n, cfg["conc_s"])
                curve.append(pt)
                if pt.p95_ttft_ms > 8000:
                    break
            except Exception:
                break

    knee = _compute_knee(curve)
    return BenchmarkResult(
        tps_avg=tps_avg,
        tps_p95=tps_p95,
        ttft_p50=ttft_p50,
        ttft_p95=ttft_p95,
        prefill_tps=prefill_tps,
        cold_start_seconds=None,
        concurrency_curve=curve,
        knee_concurrency=knee,
    )
