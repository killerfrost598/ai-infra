from fastapi import APIRouter

from app.api.v1.endpoints.api_keys import router as api_keys_router
from app.api.v1.endpoints.clore import router as clore_router
from app.api.v1.endpoints.sessions import router as sessions_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.model_deployments import router as model_deployments_router
from app.api.v1.endpoints.playbooks import router as playbooks_router
from app.api.v1.endpoints.provider_accounts import router as provider_accounts_router
from app.api.v1.endpoints.servers import router as servers_router
from app.api.v1.endpoints.settings import router as settings_router
from app.api.v1.endpoints.task_runs import router as task_runs_router

api_router = APIRouter()

api_router.include_router(health_router, prefix="", tags=["health"])
api_router.include_router(servers_router, prefix="/servers", tags=["servers"])
api_router.include_router(model_deployments_router, prefix="/model-deployments", tags=["model-deployments"])
api_router.include_router(playbooks_router, prefix="/playbooks", tags=["playbooks"])
api_router.include_router(provider_accounts_router, prefix="/provider-accounts", tags=["provider-accounts"])
api_router.include_router(task_runs_router, prefix="/task-runs", tags=["task-runs"])
api_router.include_router(api_keys_router, prefix="/api-keys", tags=["api-keys"])
api_router.include_router(settings_router, prefix="/settings", tags=["settings"])
api_router.include_router(clore_router, prefix="/clore", tags=["clore"])
api_router.include_router(sessions_router, prefix="/sessions", tags=["sessions"])
