from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.auth import request_auth_error
from app.core.config import settings

logger = logging.getLogger(__name__)


def _validate_startup_security() -> None:
    if settings.environment.strip().lower() == "production":
        if not settings.inferix_api_key.strip():
            raise RuntimeError("INFERIX_API_KEY must be set in production")
        if not settings.inferix_secret_key.strip():
            raise RuntimeError("INFERIX_SECRET_KEY must be set in production")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from datetime import datetime, timezone

    from app.db.session import SessionLocal
    from app.models.entities import Session as SessionModel, SessionStatus
    from app.services import session_store
    from app.services.compat.seeder import load_seeds

    _validate_startup_security()

    db = SessionLocal()
    try:
        load_seeds(db)
    except Exception:
        logger.exception("Compatibility seed loading failed during startup")

    # B8: reconcile sessions stuck in ACTIVE state after a restart.
    # Any ACTIVE row with no corresponding in-memory handle is unreachable — terminate it.
    try:
        stuck = db.query(SessionModel).filter(SessionModel.status == SessionStatus.ACTIVE).all()
        now = datetime.now(timezone.utc)
        for s in stuck:
            if session_store.get(str(s.id)) is None:
                s.status = SessionStatus.TERMINATED
                s.terminated_at = now
                s.metadata_json = {**(s.metadata_json or {}), "reconciled": True}
        if stuck:
            db.commit()
    except Exception:
        logger.exception("Session reconciliation failed during startup")
    finally:
        db.close()

    yield


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_api_key_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/v1") and path != "/api/v1/health":
        auth_error = request_auth_error(request)
        if auth_error is not None:
            status_code, detail = auth_error
            return JSONResponse(
                {"detail": detail},
                status_code=status_code,
                headers={"WWW-Authenticate": "ApiKey"},
            )
    return await call_next(request)


@app.middleware("http")
async def add_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET":
        path = request.url.path
        if "/api/v1/benchmarks" in path:
            response.headers["Cache-Control"] = "public, max-age=300"
        elif "/api/v1/clore/offers" in path:
            response.headers["Cache-Control"] = "public, max-age=60"
        elif "/api/v1/servers" in path or "/api/v1/playbooks" in path:
            response.headers["Cache-Control"] = "public, max-age=30"
    return response


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


app.include_router(api_router, prefix="/api/v1")
