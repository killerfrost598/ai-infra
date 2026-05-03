from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import HostCapabilitySnapshot, ModelDeployment, ModelVariant, Server
from app.schemas.model_deployments import (
    ModelDeploymentCreate,
    ModelDeploymentListResponse,
    ModelDeploymentResponse,
    ModelDeploymentUpdate,
)
from app.services.compat.feasibility import run_feasibility

router = APIRouter()


@router.get("", response_model=ModelDeploymentListResponse)
def list_model_deployments(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ModelDeploymentListResponse:
    total = db.query(ModelDeployment).count()
    items = db.query(ModelDeployment).offset(skip).limit(limit).all()
    return ModelDeploymentListResponse(items=items, total=total)


@router.post("", response_model=ModelDeploymentResponse, status_code=201)
def create_model_deployment(
    payload: ModelDeploymentCreate,
    force: bool = Query(False),
    db: Session = Depends(get_db),
) -> ModelDeployment:
    server = db.query(Server).filter(Server.id == payload.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    snapshot = (
        db.query(HostCapabilitySnapshot)
        .filter(HostCapabilitySnapshot.server_id == payload.server_id)
        .order_by(HostCapabilitySnapshot.captured_at.desc())
        .first()
    )

    variant: ModelVariant | None = None
    model_key = payload.model_name
    quant = payload.quantization or "auto"
    if payload.model_variant_id:
        variant = db.query(ModelVariant).filter(ModelVariant.id == payload.model_variant_id).first()
        if variant:
            model_key = variant.model_key
            quant = variant.quant

    gpu_name = server.gpu_model
    vram_gb_total = server.vram_gb
    gpu_count = 1
    driver_version = server.cuda_version
    if snapshot and snapshot.gpus:
        gpu_name = snapshot.gpus[0].get("name")
        vram_gb_total = sum(g.get("vram_gb", 0) for g in snapshot.gpus)
        gpu_count = snapshot.gpu_count
        driver_version = snapshot.driver_version

    report = run_feasibility(
        db=db,
        gpu_name=gpu_name,
        vram_gb_total=vram_gb_total,
        gpu_count=gpu_count,
        driver_version=driver_version,
        snapshot=snapshot,
        model_key=model_key,
        quant=quant,
        engine=payload.engine.value,
        tp_size=payload.tp_size,
    )

    if report.verdict == "BLOCKED" and not force:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Feasibility check failed — pass ?force=true to override",
                "report": {
                    "verdict": report.verdict,
                    "mode": report.mode,
                    "checks": [
                        {"id": c.id, "status": c.status, "reason": c.reason, "source": c.source}
                        for c in report.checks
                    ],
                },
            },
        )

    # Store tp_size in install_plan_json so the Celery task can read it
    deployment_data = payload.model_dump(exclude={"tp_size"})
    deployment_data["install_plan_json"] = {"tp_size": payload.tp_size}
    deployment = ModelDeployment(**deployment_data)
    db.add(deployment)
    db.commit()
    db.refresh(deployment)

    from app.workers.tasks import deploy_model
    deploy_model.delay(str(deployment.id))
    return deployment


@router.get("/{deployment_id}", response_model=ModelDeploymentResponse)
def get_model_deployment(deployment_id: UUID, db: Session = Depends(get_db)) -> ModelDeployment:
    deployment = db.query(ModelDeployment).filter(ModelDeployment.id == deployment_id).first()
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return deployment


@router.patch("/{deployment_id}", response_model=ModelDeploymentResponse)
def update_model_deployment(
    deployment_id: UUID,
    payload: ModelDeploymentUpdate,
    db: Session = Depends(get_db),
) -> ModelDeployment:
    deployment = db.query(ModelDeployment).filter(ModelDeployment.id == deployment_id).first()
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(deployment, key, value)
    db.commit()
    db.refresh(deployment)
    return deployment


@router.delete("/{deployment_id}", status_code=204)
def delete_model_deployment(deployment_id: UUID, db: Session = Depends(get_db)) -> None:
    deployment = db.query(ModelDeployment).filter(ModelDeployment.id == deployment_id).first()
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    db.delete(deployment)
    db.commit()
