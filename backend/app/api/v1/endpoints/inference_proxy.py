"""Inference reverse-proxy API."""

from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal, get_db
from app.models.entities import InferenceProxyRoute
from app.schemas.inference_proxy import (
    InferenceProxyMetricResponse,
    InferenceProxyRouteResponse,
    InferenceProxyRoutesResponse,
)
from app.services.inference_proxy import (
    list_active_routes,
    metric_summary,
    proxy_json_request,
    proxy_stream_request,
)

router = APIRouter()


def _proxy_base_url(route: InferenceProxyRoute) -> str:
    public_base = settings.inference_proxy_public_base_url.strip().rstrip("/")
    if public_base:
        return f"{public_base}/{route.route_slug}/v1"
    return f"/api/v1/inference/{route.route_slug}/v1"


def _route_response(route: InferenceProxyRoute) -> InferenceProxyRouteResponse:
    return InferenceProxyRouteResponse(
        id=route.id,
        route_slug=route.route_slug,
        server_id=route.server_id,
        session_id=route.session_id,
        model_id=route.model_id,
        quant_id=route.quant_id,
        model_run_id=route.model_run_id,
        model_name=route.model_name,
        target_base_url=route.target_base_url,
        proxy_base_url=_proxy_base_url(route),
        remote_port=route.remote_port,
        profile_json=route.profile_json,
        status=route.status,
        hourly_cost_usd=route.hourly_cost_usd,
        last_seen_at=route.last_seen_at,
        created_at=route.created_at,
        updated_at=route.updated_at,
    )


@router.get("/routes", response_model=InferenceProxyRoutesResponse)
def routes(db: Session = Depends(get_db)) -> InferenceProxyRoutesResponse:
    return InferenceProxyRoutesResponse(routes=[_route_response(route) for route in list_active_routes(db)])


@router.get("/metrics", response_model=InferenceProxyMetricResponse)
def metrics(
    server_id: UUID | None = Query(None),
    db: Session = Depends(get_db),
) -> InferenceProxyMetricResponse:
    active_query = db.query(InferenceProxyRoute).filter(InferenceProxyRoute.status == "active")
    if server_id:
        active_query = active_query.filter(InferenceProxyRoute.server_id == server_id)
    return InferenceProxyMetricResponse(
        summary=metric_summary(db, server_id=server_id),
        active_routes=active_query.count(),
    )


def _find_route(db: Session, route_slug: str) -> InferenceProxyRoute:
    route = db.query(InferenceProxyRoute).filter(
        InferenceProxyRoute.route_slug == route_slug,
        InferenceProxyRoute.status == "active",
    ).first()
    if route is None:
        try:
            route_id = UUID(route_slug)
        except ValueError:
            route_id = None
        if route_id:
            route = db.query(InferenceProxyRoute).filter(
                InferenceProxyRoute.id == route_id,
                InferenceProxyRoute.status == "active",
            ).first()
    if route is None:
        raise HTTPException(status_code=404, detail="Inference proxy route not found")
    return route


@router.api_route("/{route_slug}/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_openai_compatible(
    route_slug: str,
    path: str,
    request: Request,
    db: Session = Depends(get_db),
):
    route = _find_route(db, route_slug)
    raw_body = await request.body()
    body = None
    if raw_body:
        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail="Proxy body must be JSON") from exc
    if body is not None and not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Proxy body must be a JSON object")

    is_stream = bool(body and body.get("stream")) and request.method.upper() == "POST"
    if is_stream:
        return StreamingResponse(
            proxy_stream_request(
                SessionLocal,
                route.id,
                method=request.method,
                path=path,
                body=body,
            ),
            media_type="text/event-stream",
        )

    try:
        content, status_code, media_type = proxy_json_request(
            db,
            route,
            method=request.method,
            path=path,
            body=body,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(content=content, status_code=status_code, media_type=media_type)
