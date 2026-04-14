from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import ModelDeployment
from app.schemas.model_deployments import (
    ModelDeploymentCreate,
    ModelDeploymentListResponse,
    ModelDeploymentResponse,
    ModelDeploymentUpdate,
)

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
def create_model_deployment(payload: ModelDeploymentCreate, db: Session = Depends(get_db)) -> ModelDeployment:
    deployment = ModelDeployment(**payload.model_dump())
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
