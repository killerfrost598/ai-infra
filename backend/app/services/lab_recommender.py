"""Lab recommendation engine: given server + model + quant, produce a feasibility-checked launch plan."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.entities import EngineKind, Model, ModelQuant, ModelVariant
from app.models.entities import Session as SessionModel
from app.schemas.lab import (
    FeasibilityCheckOut,
    FeasibilityReportOut,
    InstallPlanOut,
    LaunchRecommendation,
    ParallelPlanOut,
)
from app.services.compat.feasibility import run_feasibility_for_quant

logger = logging.getLogger(__name__)


def _snapshot_proxy(snap_dict: dict) -> SimpleNamespace:
    """Convert a metadata_json["host_snapshot"] dict into a duck-typed snapshot proxy.

    select_stack / recommend_parallel / run_feasibility access attributes by name;
    SimpleNamespace satisfies all of them without requiring a DB round-trip.
    """
    return SimpleNamespace(
        gpus=snap_dict.get("gpus") or [],
        gpu_count=snap_dict.get("gpu_count") or 0,
        driver_version=snap_dict.get("driver_version"),
        cuda_runtime_host=snap_dict.get("cuda_runtime_host"),
        homogeneous=snap_dict.get("homogeneous", True),
        nvlink_topology=snap_dict.get("nvlink_topology"),
        docker_present=snap_dict.get("docker_present", False),
        nvidia_container_toolkit=snap_dict.get("nvidia_container_toolkit", False),
    )


def _to_feasibility_out(report) -> FeasibilityReportOut:
    return FeasibilityReportOut(
        verdict=report.verdict,
        mode=report.mode,
        gpu_profile_key=report.gpu_profile_key,
        stack_matrix_id=report.stack_matrix_id,
        checks=[
            FeasibilityCheckOut(id=c.id, status=c.status, reason=c.reason, source=c.source)
            for c in report.checks
        ],
    )


def _to_parallel_out(pp) -> ParallelPlanOut:
    return ParallelPlanOut(
        tp_size=pp.tp_size,
        blocked=pp.blocked,
        block_reason=pp.block_reason,
        nvlink=pp.nvlink,
        interconnect_label=pp.interconnect_label,
    )


def _to_install_out(plan) -> InstallPlanOut:
    return InstallPlanOut(
        stack_matrix_id=plan.stack_matrix_id,
        mode=plan.mode,
        container_image=plan.container_image,
        pip_index_url=plan.pip_index_url,
        packages=list(plan.packages),
        launch_cmd=plan.launch_cmd,
        tp_size=plan.tp_size,
        gpu_memory_utilization=plan.gpu_memory_utilization,
        env=plan.env,
        remote_port=plan.remote_port,
    )


def recommend_launch(
    *,
    server_id: UUID,
    model_id: UUID,
    quant_id: UUID,
    engine_str: str,
    db: Session,
    session_id: UUID | None = None,
    remote_port: int = 8000,
) -> LaunchRecommendation:
    """Produce a feasibility-checked launch plan for the given server + model + quant.

    Returns requires_reprobe=True when no host snapshot is available.
    Makes no outbound HTTP calls — reads only local DB and Redis.
    """
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        return LaunchRecommendation(warnings=["Model not found"], force_required=False)

    quant = db.query(ModelQuant).filter(ModelQuant.id == quant_id).first()
    if not quant:
        return LaunchRecommendation(warnings=["ModelQuant not found"], force_required=False)

    try:
        engine = EngineKind(engine_str.upper())
    except ValueError:
        return LaunchRecommendation(warnings=[f"Unknown engine: {engine_str}"], force_required=False)

    # -- Locate host snapshot --------------------------------------------------
    snap_dict: dict | None = None

    if session_id:
        sess = db.query(SessionModel).filter(SessionModel.id == session_id).first()
        if sess:
            snap_dict = (sess.metadata_json or {}).get("host_snapshot")

    if not snap_dict:
        # Fall back to the most recently updated active session for this server
        fallback_sess = (
            db.query(SessionModel)
            .filter(SessionModel.server_id == server_id)
            .order_by(SessionModel.started_at.desc())
            .first()
        )
        if fallback_sess:
            snap_dict = (fallback_sess.metadata_json or {}).get("host_snapshot")

    if not snap_dict:
        return LaunchRecommendation(requires_reprobe=True, warnings=["No host snapshot — run a Reprobe first"])

    proxy = _snapshot_proxy(snap_dict)

    # -- Feasibility check -----------------------------------------------------
    gpu_name = proxy.gpus[0].get("name") if proxy.gpus else None
    vram_total = sum(g.get("vram_gb", 0) for g in proxy.gpus)

    feasibility = run_feasibility_for_quant(
        db=db,
        model=model,
        quant=quant,
        gpu_name=gpu_name,
        vram_gb_total=vram_total,
        gpu_count=proxy.gpu_count,
        driver_version=proxy.driver_version,
        snapshot=proxy,  # type: ignore[arg-type]  # duck-typed proxy
        engine=engine_str,
        tp_size=1,
    )
    feasibility_out = _to_feasibility_out(feasibility)

    warnings: list[str] = []
    force_required = feasibility.verdict == "BLOCKED"
    if force_required:
        for check in feasibility.checks:
            if check.status == "FAIL":
                warnings.append(f"{check.id}: {check.reason}")

    # -- Stack selection (skipped when BLOCKED) --------------------------------
    parallel_out: ParallelPlanOut | None = None
    install_out: InstallPlanOut | None = None
    injectable_command = ""

    if feasibility.verdict != "BLOCKED":
        variant = db.query(ModelVariant).filter_by(
            model_key=model.model_key, quant=quant.name
        ).first()

        if variant is None:
            warnings.append(f"No ModelVariant bridge row for {model.model_key}/{quant.name} — re-seed the model")
        else:
            # Parallel plan (informational; select_stack also calls this internally)
            if proxy.gpu_count > 1:
                from app.services.compat.parallel import recommend_parallel
                pp = recommend_parallel(variant, proxy)
                parallel_out = _to_parallel_out(pp)

            # HF token from platform settings
            hf_token: str | None = None
            try:
                from app.models.entities import PlatformSetting
                setting = db.query(PlatformSetting).filter_by(key="hf_token").first()
                hf_token = setting.value if setting else None
            except Exception:
                pass

            try:
                from app.services.compat.selector import select_stack
                plan = select_stack(
                    snapshot=proxy,  # type: ignore[arg-type]
                    variant=variant,
                    engine=engine,
                    db=db,
                    remote_port=remote_port,
                    hf_token=hf_token,
                )
                install_out = _to_install_out(plan)
                injectable_command = plan.launch_cmd
                # Capture parallel plan from select_stack's TP decision
                if parallel_out is None and plan.tp_size > 1:
                    parallel_out = ParallelPlanOut(
                        tp_size=plan.tp_size,
                        blocked=False,
                        block_reason=None,
                        nvlink=False,
                        interconnect_label="PCIe",
                    )
            except NotImplementedError as exc:
                warnings.append(str(exc))
            except ValueError as exc:
                warnings.append(str(exc))
            except Exception as exc:
                logger.warning("select_stack failed: %s", exc)
                warnings.append(f"Stack selection error: {exc}")

    return LaunchRecommendation(
        requires_reprobe=False,
        feasibility=feasibility_out,
        parallel=parallel_out,
        install_plan=install_out,
        injectable_command=injectable_command,
        warnings=warnings,
        force_required=force_required,
    )
