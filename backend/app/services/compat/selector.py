from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Literal

from sqlalchemy.orm import Session

from app.models.entities import EngineKind, HostCapabilitySnapshot, ModelVariant, StackMatrix


@dataclass(frozen=True)
class InstallPlan:
    stack_matrix_id: int
    mode: Literal["container", "venv"]
    container_image: str | None
    pip_index_url: str | None
    packages: tuple[str, ...]
    launch_cmd: str
    tp_size: int
    gpu_memory_utilization: float
    env: dict[str, str]
    remote_port: int

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


def _cc_gte(cc_a: str, cc_b: str) -> bool:
    try:
        return tuple(int(x) for x in cc_a.split(".")) >= tuple(int(x) for x in cc_b.split("."))
    except (ValueError, AttributeError):
        return False


def select_stack(
    snapshot: HostCapabilitySnapshot,
    variant: ModelVariant,
    engine: EngineKind,
    db: Session,
    tp_size: int = 1,
    remote_port: int = 8000,
    hf_token: str | None = None,
) -> InstallPlan:
    if not snapshot.gpus:
        raise ValueError("No GPUs found in capability snapshot — reprobe before deploying")

    # Override caller's tp_size with the recommender for multi-GPU hosts
    if snapshot.gpu_count > 1:
        from app.services.compat.parallel import recommend_parallel
        pp = recommend_parallel(variant, snapshot)
        if pp.blocked:
            raise ValueError(f"Cannot deploy: {pp.block_reason}")
        tp_size = pp.tp_size

    cc = snapshot.gpus[0]["cc"]

    candidates = db.query(StackMatrix).filter(StackMatrix.is_active == True).all()  # noqa: E712
    matching = [
        s for s in candidates
        if _cc_gte(cc, s.cc_min)
        and (s.cc_max is None or _cc_gte(s.cc_max, cc))
        and (engine != EngineKind.VLLM or s.vllm is not None)
        and (engine != EngineKind.SGLANG or s.sglang is not None)
    ]
    matching.sort(key=lambda s: -s.priority)

    if not matching:
        raise ValueError(f"No active stack_matrix row for CC={cc} engine={engine.value}")

    chosen = matching[0]

    mode: Literal["container", "venv"] = (
        "container"
        if chosen.container_image and snapshot.docker_present and snapshot.nvidia_container_toolkit
        else "venv"
    )

    if engine == EngineKind.VLLM:
        from app.services.compat.launchers.vllm import build_launch_cmd
        launch_cmd = build_launch_cmd(variant, chosen, snapshot, mode, tp_size, remote_port, hf_token)
    else:
        raise NotImplementedError(f"Engine {engine.value} not yet supported (Phase 4.5)")

    packages: tuple[str, ...]
    if chosen.vllm:
        packages = (f"vllm=={chosen.vllm}", f"torch=={chosen.torch}")
    else:
        packages = ()

    return InstallPlan(
        stack_matrix_id=chosen.id,
        mode=mode,
        container_image=chosen.container_image,
        pip_index_url=chosen.pip_index_url,
        packages=packages,
        launch_cmd=launch_cmd,
        tp_size=tp_size,
        gpu_memory_utilization=0.90,
        env={},
        remote_port=remote_port,
    )
