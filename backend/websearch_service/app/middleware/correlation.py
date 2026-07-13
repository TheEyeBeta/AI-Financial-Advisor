"""Correlation ID middleware and structured request logging."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from contextvars import ContextVar
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

correlation_id_var: ContextVar[str | None] = ContextVar("correlation_id", default=None)

_SENSITIVE_KEYS = frozenset(
    {
        "authorization",
        "password",
        "token",
        "access_token",
        "refresh_token",
        "api_key",
        "secret",
        "cookie",
    }
)

_logger = logging.getLogger("app.request")


def get_correlation_id() -> str | None:
    return correlation_id_var.get()


def redact_mapping(payload: dict[str, Any]) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for key, value in payload.items():
        if key.lower() in _SENSITIVE_KEYS:
            redacted[key] = "[REDACTED]"
        elif isinstance(value, dict):
            redacted[key] = redact_mapping(value)
        else:
            redacted[key] = value
    return redacted


def log_event(event: str, **fields: Any) -> None:
    payload = {
        "event": event,
        "correlation_id": get_correlation_id(),
        "environment": os.getenv("ENVIRONMENT", "development"),
        "release": os.getenv("APP_VERSION", "unknown"),
        **redact_mapping(fields),
    }
    if os.getenv("STRUCTURED_LOGS", "").strip().lower() in {"1", "true", "yes"} or (
        os.getenv("ENVIRONMENT", "").strip().lower() == "production"
    ):
        _logger.info(json.dumps(payload, default=str))
    else:
        _logger.info("%s %s", event, payload)


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Attach/propagate X-Request-ID and emit structured access logs."""

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming = (request.headers.get("X-Request-ID") or "").strip()
        correlation_id = incoming or uuid.uuid4().hex
        token = correlation_id_var.set(correlation_id)
        request.state.correlation_id = correlation_id
        started = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            log_event(
                "http_request_error",
                method=request.method,
                path=request.url.path,
                duration_ms=duration_ms,
                error=type(exc).__name__,
            )
            correlation_id_var.reset(token)
            raise

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = correlation_id
        log_event(
            "http_request",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
        correlation_id_var.reset(token)
        return response
