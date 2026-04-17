from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings

app = FastAPI(title=settings.app_name, version=settings.app_version)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
