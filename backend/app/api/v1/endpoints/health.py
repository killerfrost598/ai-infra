from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def versioned_health() -> dict[str, str]:
    return {"status": "ok", "scope": "api_v1"}
