"""Multi-GPU tensor-parallel plan recommender."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ParallelPlan:
    tp_size: int
    blocked: bool
    block_reason: str | None
    nvlink: bool
    interconnect_label: str  # "NVLink" | "PCIe" | "single-GPU" | "mixed"


def recommend_parallel(variant, snapshot) -> ParallelPlan:
    """Determine the best TP parallelism plan for a multi-GPU host.

    Rules (in order):
    1. Single GPU  → tp_size=1, no parallelism.
    2. Heterogeneous GPUs → hard-block.
    3. NVLink detected   → prefer highest allowed tp_size.
    4. PCIe only         → prefer smallest tp_size > 1 that fits and divides heads.
    """
    if not snapshot or snapshot.gpu_count <= 1:
        return ParallelPlan(
            tp_size=1,
            blocked=False,
            block_reason=None,
            nvlink=False,
            interconnect_label="single-GPU",
        )

    if not snapshot.homogeneous:
        return ParallelPlan(
            tp_size=1,
            blocked=True,
            block_reason="Mixed GPUs — TP unsupported",
            nvlink=False,
            interconnect_label="mixed",
        )

    nvlink = bool(snapshot.nvlink_topology and "NVLink" in snapshot.nvlink_topology)
    interconnect_label = "NVLink" if nvlink else "PCIe"

    # Allowed sizes from variant; default to powers of 2 up to gpu_count
    allowed: list[int] = list(variant.tp_allowed_sizes or [])
    if not allowed:
        g = snapshot.gpu_count
        allowed = [s for s in [1, 2, 4, 8] if s <= g]

    num_heads = getattr(variant, "num_attention_heads", None)
    fitting = [
        s for s in allowed
        if s <= snapshot.gpu_count
        and (num_heads is None or num_heads % s == 0)
    ]

    if not fitting:
        return ParallelPlan(
            tp_size=1,
            blocked=False,
            block_reason=None,
            nvlink=nvlink,
            interconnect_label=interconnect_label,
        )

    # NVLink → highest; PCIe → lowest > 1 (minimises latency exposure)
    if nvlink:
        best = max(fitting)
    else:
        candidates = [s for s in fitting if s > 1]
        best = min(candidates) if candidates else 1

    return ParallelPlan(
        tp_size=best,
        blocked=False,
        block_reason=None,
        nvlink=nvlink,
        interconnect_label=interconnect_label,
    )
