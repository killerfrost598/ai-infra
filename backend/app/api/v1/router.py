from fastapi import APIRouter

from app.api.v1.endpoints.benchmarks import router as benchmarks_router
from app.api.v1.endpoints.clore import router as clore_router
from app.api.v1.endpoints.compat import router as compat_router
from app.api.v1.endpoints.feasibility import router as feasibility_router
from app.api.v1.endpoints.sessions import router as sessions_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.model_deployments import router as model_deployments_router
from app.api.v1.endpoints.playbooks import router as playbooks_router
from app.api.v1.endpoints.servers import router as servers_router
from app.api.v1.endpoints.settings import router as settings_router
from app.api.v1.endpoints.task_runs import router as task_runs_router

api_router = APIRouter()

api_router.include_router(health_router, prefix="", tags=["health"])
api_router.include_router(servers_router, prefix="/servers", tags=["servers"])
api_router.include_router(model_deployments_router, prefix="/model-deployments", tags=["model-deployments"])
api_router.include_router(playbooks_router, prefix="/playbooks", tags=["playbooks"])
api_router.include_router(task_runs_router, prefix="/task-runs", tags=["task-runs"])
api_router.include_router(settings_router, prefix="/settings", tags=["settings"])
api_router.include_router(clore_router, prefix="/clore", tags=["clore"])
api_router.include_router(sessions_router, prefix="/sessions", tags=["sessions"])
api_router.include_router(benchmarks_router, prefix="/benchmarks", tags=["benchmarks"])
api_router.include_router(feasibility_router, prefix="/feasibility", tags=["feasibility"])
api_router.include_router(compat_router, prefix="/compat", tags=["compat"])
