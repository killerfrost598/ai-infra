from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy.orm import Session

from app.models.entities import GpuProfile, HostCapabilitySnapshot, ModelVariant, StackMatrix

CheckStatus = Literal["PASS", "FAIL", "UNKNOWN"]
Source = Literal["predicted", "snapshot"]
Verdict = Literal["READY", "BLOCKED", "UNKNOWN"]
Mode = Literal["predicted", "verified"]


@dataclass(frozen=True)
class CheckResult:
    id: str
    status: CheckStatus
    reason: str
    source: Source


@dataclass(frozen=True)
class FeasibilityReport:
    verdict: Verdict
    mode: Mode
    gpu_profile_key: str | None
    stack_matrix_id: int | None
    checks: list[CheckResult]


def _cc_gte(cc_a: str, cc_b: str) -> bool:
    """Return True if cc_a >= cc_b (e.g. '8.9' >= '8.0')."""
    try:
        return tuple(int(x) for x in cc_a.split(".")) >= tuple(int(x) for x in cc_b.split("."))
    except (ValueError, AttributeError):
        return False


def _driver_gte(driver_a: str | None, driver_min: str) -> bool:
    if not driver_a:
        return False
    try:
        return int(driver_a.split(".")[0]) >= int(driver_min.split(".")[0])
    except (ValueError, AttributeError):
        return False


def run_feasibility(
    *,
    db: Session,
    gpu_name: str | None,
    vram_gb_total: int | None,
    gpu_count: int,
    driver_version: str | None,
    snapshot: HostCapabilitySnapshot | None,
    model_key: str,
    quant: str,
    engine: str,
    tp_size: int,
) -> FeasibilityReport:
    source: Source = "snapshot" if snapshot else "predicted"
    mode: Mode = "verified" if snapshot else "predicted"
    checks: list[CheckResult] = []

    # -- 1. gpu_arch_known --
    gpu_profile: GpuProfile | None = None
    if gpu_name:
        all_profiles = db.query(GpuProfile).all()
        for p in all_profiles:
            aliases = p.aliases or []
            if gpu_name.lower() == p.display_name.lower() or any(
                gpu_name.lower() == a.lower() for a in aliases
            ):
                gpu_profile = p
                break
    if gpu_profile:
        checks.append(CheckResult("gpu_arch_known", "PASS", f"Matched profile '{gpu_profile.model_key}'", source))
    else:
        checks.append(CheckResult("gpu_arch_known", "UNKNOWN", f"No profile matched '{gpu_name}'", source))

    # -- 2. driver_min --
    best_stack: StackMatrix | None = None
    if gpu_profile:
        engine_upper = engine.upper()
        candidates = db.query(StackMatrix).filter(StackMatrix.is_active == True).all()
        matching = [
            s for s in candidates
            if _cc_gte(gpu_profile.cc, s.cc_min)
            and (s.cc_max is None or _cc_gte(s.cc_max, gpu_profile.cc))
            and (engine_upper != "VLLM" or s.vllm is not None)
            and (engine_upper != "SGLANG" or s.sglang is not None)
        ]
        matching.sort(key=lambda s: -s.priority)
        best_stack = matching[0] if matching else None

    if best_stack and driver_version:
        if _driver_gte(driver_version, best_stack.driver_min):
            checks.append(CheckResult("driver_min", "PASS", f"Driver {driver_version} >= {best_stack.driver_min}", source))
        else:
            checks.append(CheckResult("driver_min", "FAIL", f"Driver {driver_version} < {best_stack.driver_min} required", source))
    elif best_stack and not driver_version:
        checks.append(CheckResult("driver_min", "UNKNOWN", f"Requires driver >= {best_stack.driver_min}; actual unknown", "predicted"))
    else:
        checks.append(CheckResult("driver_min", "UNKNOWN", "No matching stack found to determine driver requirement", "predicted"))

    # -- 3. vram_sufficient --
    variant: ModelVariant | None = db.query(ModelVariant).filter_by(model_key=model_key, quant=quant).first()
    effective_vram = vram_gb_total
    if snapshot and snapshot.gpus:
        effective_vram = sum(g.get("vram_gb", 0) for g in snapshot.gpus)
    if variant and effective_vram is not None:
        needed = variant.vram_min_gb * 1.15
        if effective_vram >= needed:
            checks.append(CheckResult("vram_sufficient", "PASS", f"{effective_vram} GB >= {needed:.1f} GB needed", source))
        else:
            checks.append(CheckResult("vram_sufficient", "FAIL", f"{effective_vram} GB < {needed:.1f} GB needed", source))
    else:
        checks.append(CheckResult("vram_sufficient", "UNKNOWN", "VRAM data unavailable", source))

    # -- 4. cc_supports_quant --
    if gpu_profile and variant:
        if _cc_gte(gpu_profile.cc, variant.cc_min):
            checks.append(CheckResult("cc_supports_quant", "PASS", f"CC {gpu_profile.cc} >= {variant.cc_min} for {quant}", source))
        else:
            checks.append(CheckResult("cc_supports_quant", "FAIL", f"CC {gpu_profile.cc} < {variant.cc_min} required for {quant}", source))
    else:
        checks.append(CheckResult("cc_supports_quant", "UNKNOWN", "GPU profile or variant not resolved", source))

    # -- 5. fp8_native --
    if quant.upper() in ("FP8",):
        if gpu_profile:
            if gpu_profile.fp8_native:
                checks.append(CheckResult("fp8_native", "PASS", f"{gpu_profile.model_key} has native FP8", source))
            else:
                checks.append(CheckResult("fp8_native", "FAIL", f"CC {gpu_profile.cc} — no native FP8 (needs CC >= 8.9)", source))
        else:
            checks.append(CheckResult("fp8_native", "UNKNOWN", "GPU profile not resolved", source))
    else:
        checks.append(CheckResult("fp8_native", "PASS", f"FP8 check not applicable for {quant}", source))

    # -- 6. arch_supported_engine --
    if variant:
        engine_upper = engine.upper()
        if engine_upper == "VLLM":
            ok = variant.arch_supported_vllm
        elif engine_upper == "SGLANG":
            ok = variant.arch_supported_sglang
        else:
            ok = True
        if ok:
            checks.append(CheckResult("arch_supported_engine", "PASS", f"{engine} supports {model_key}/{quant}", source))
        else:
            checks.append(CheckResult("arch_supported_engine", "FAIL", f"{engine} does not support {quant} format for {model_key}", source))
    else:
        checks.append(CheckResult("arch_supported_engine", "UNKNOWN", "Variant not found", source))

    # -- 7. tp_divides_heads --
    if variant and variant.num_attention_heads:
        if variant.num_attention_heads % tp_size == 0:
            checks.append(CheckResult("tp_divides_heads", "PASS", f"TP={tp_size} divides {variant.num_attention_heads} heads evenly", source))
        else:
            checks.append(CheckResult("tp_divides_heads", "FAIL", f"TP={tp_size} does not divide {variant.num_attention_heads} heads", source))
    elif tp_size == 1:
        checks.append(CheckResult("tp_divides_heads", "PASS", "TP=1 always valid", source))
    else:
        checks.append(CheckResult("tp_divides_heads", "UNKNOWN", "Attention head count not available", source))

    # -- 8. tp_size_allowed --
    if variant and variant.tp_allowed_sizes:
        if tp_size in variant.tp_allowed_sizes:
            checks.append(CheckResult("tp_size_allowed", "PASS", f"TP={tp_size} in allowed sizes {variant.tp_allowed_sizes}", source))
        else:
            checks.append(CheckResult("tp_size_allowed", "FAIL", f"TP={tp_size} not in allowed sizes {variant.tp_allowed_sizes}", source))
    elif tp_size == 1:
        checks.append(CheckResult("tp_size_allowed", "PASS", "TP=1 always allowed", source))
    else:
        checks.append(CheckResult("tp_size_allowed", "UNKNOWN", "Allowed TP sizes not configured", source))

    # -- 9. tp_size_fits_host --
    if snapshot:
        if tp_size <= snapshot.gpu_count:
            checks.append(CheckResult("tp_size_fits_host", "PASS", f"TP={tp_size} <= {snapshot.gpu_count} GPUs", "snapshot"))
        else:
            checks.append(CheckResult("tp_size_fits_host", "FAIL", f"TP={tp_size} > {snapshot.gpu_count} GPUs available", "snapshot"))
    elif tp_size <= gpu_count:
        checks.append(CheckResult("tp_size_fits_host", "PASS", f"TP={tp_size} <= {gpu_count} GPUs (predicted from offer)", "predicted"))
    else:
        checks.append(CheckResult("tp_size_fits_host", "UNKNOWN", f"TP={tp_size}; GPU count unknown in predicted mode", "predicted"))

    # -- 10. gpu_homogeneous --
    if snapshot:
        if snapshot.homogeneous:
            checks.append(CheckResult("gpu_homogeneous", "PASS", "All GPUs are the same model", "snapshot"))
        else:
            checks.append(CheckResult("gpu_homogeneous", "FAIL", "Heterogeneous GPUs detected — TP unsupported", "snapshot"))
    else:
        checks.append(CheckResult("gpu_homogeneous", "UNKNOWN", "Homogeneity not verifiable in predicted mode", "predicted"))

    # -- 11. stack_available --
    if best_stack:
        checks.append(CheckResult("stack_available", "PASS", f"Stack '{best_stack.container_image}' available for CC {gpu_profile.cc if gpu_profile else '?'}", source))
    elif gpu_profile:
        checks.append(CheckResult("stack_available", "FAIL", f"No active stack found for CC {gpu_profile.cc} + engine {engine}", source))
    else:
        checks.append(CheckResult("stack_available", "UNKNOWN", "GPU profile not resolved; cannot determine stack", source))

    # Verdict
    statuses = {c.status for c in checks}
    if "FAIL" in statuses:
        verdict: Verdict = "BLOCKED"
    elif "UNKNOWN" in statuses:
        verdict = "UNKNOWN"
    else:
        verdict = "READY"

    return FeasibilityReport(
        verdict=verdict,
        mode=mode,
        gpu_profile_key=gpu_profile.model_key if gpu_profile else None,
        stack_matrix_id=best_stack.id if best_stack else None,
        checks=checks,
    )
