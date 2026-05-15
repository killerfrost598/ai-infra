"""API-key guard for the Inferix control plane."""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Header, HTTPException, Query, Request, WebSocket, status

from app.core.config import settings

_DEV_ENVIRONMENTS = {"development", "dev", "local", "test", "testing"}


def _configured_key() -> str:
    return settings.inferix_api_key.strip()


def _auth_disabled_for_local_dev() -> bool:
    return not _configured_key() and settings.environment.strip().lower() in _DEV_ENVIRONMENTS


def _valid_candidate(candidate: str | None) -> bool:
    expected = _configured_key()
    return bool(expected and candidate and hmac.compare_digest(candidate, expected))


def request_auth_error(request: Request, api_key: str | None = None) -> tuple[int, str] | None:
    if _auth_disabled_for_local_dev():
        return None
    if not _configured_key():
        return status.HTTP_503_SERVICE_UNAVAILABLE, "INFERIX_API_KEY is not configured"

    header_key = request.headers.get("x-inferix-api-key")
    query_key = api_key if api_key is not None else request.query_params.get("api_key")
    cookie_key = request.cookies.get("inferix_api_key")
    if _valid_candidate(header_key) or _valid_candidate(query_key) or _valid_candidate(cookie_key):
        return None
    return status.HTTP_401_UNAUTHORIZED, "Missing or invalid API key"


def require_api_key(
    request: Request,
    x_inferix_api_key: Annotated[str | None, Header(alias="X-Inferix-Api-Key")] = None,
    api_key: Annotated[str | None, Query(alias="api_key")] = None,
) -> None:
    """Require the configured API key for HTTP requests.

    Local development remains open when `INFERIX_API_KEY` is unset. Production
    startup rejects that configuration in `app.main`.
    """
    auth_error = request_auth_error(request, api_key=api_key)
    if auth_error is None:
        return

    status_code, detail = auth_error
    raise HTTPException(
        status_code=status_code,
        detail=detail,
        headers={"WWW-Authenticate": "ApiKey"},
    )


def websocket_api_key_valid(websocket: WebSocket) -> bool:
    """Validate API key for browser WebSockets where custom headers are unavailable."""
    if _auth_disabled_for_local_dev():
        return True

    header_key = websocket.headers.get("x-inferix-api-key")
    query_key = websocket.query_params.get("api_key")
    cookie_key = websocket.cookies.get("inferix_api_key")
    return _valid_candidate(header_key) or _valid_candidate(query_key) or _valid_candidate(cookie_key)
