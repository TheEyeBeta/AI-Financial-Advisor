"""Correlation ID middleware and structured request logging."""

from __future__ import annotations

import json
import logging
import os
import re
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
        "passwd",
        "pwd",
        "token",
        "access_token",
        "refresh_token",
        "id_token",
        "api_key",
        "apikey",
        "secret",
        "client_secret",
        "cookie",
        "set-cookie",
        "jwt",
        "service_role_key",
        "supabase_service_role_key",
        "supabase_jwt_secret",
        "openai_api_key",
        "database_url",
        "connection_string",
        "dsn",
        "private_key",
        # Sensitive user financial data — never log values.
        "ssn",
        "account_number",
        "routing_number",
        "card_number",
        "cvv",
        "iban",
    }
)

# Value-level secret patterns — scrub secrets that leak *inside* free-text
# strings (not just dict keys). Order matters: URIs before generic key=value.
_DB_URI_RE = re.compile(
    r"\b(?:postgres(?:ql)?|redis|rediss|mysql|mongodb(?:\+srv)?|amqp)://[^\s:@/]*:[^\s@/]+@\S+",
    re.IGNORECASE,
)
_CREDS_URI_RE = re.compile(r"\b[a-z][a-z0-9+.\-]*://[^\s:@/]*:[^\s@/]+@\S+", re.IGNORECASE)
_JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}")
_BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._\-]+", re.IGNORECASE)
_OPENAI_KEY_RE = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}")
_INLINE_KV_RE = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|client_secret|api[_-]?key|access_token|"
    r"refresh_token|service_role_key|token)\b(\s*[=:]\s*)(\"?)([^\s\"',}]+)"
)

_logger = logging.getLogger("app.request")


def redact_text(value: Any) -> Any:
    """Scrub secret values embedded inside a string (JWTs, bearer tokens, API
    keys, credentialed URIs, and inline key=value secrets). Non-strings pass
    through unchanged."""
    if not isinstance(value, str):
        return value
    s = _DB_URI_RE.sub("[REDACTED_URI]", value)
    s = _CREDS_URI_RE.sub("[REDACTED_URI]", s)
    # Bearer before JWT so "Bearer <jwt>" collapses to a single marker.
    s = _BEARER_RE.sub("Bearer [REDACTED]", s)
    s = _JWT_RE.sub("[REDACTED_JWT]", s)
    s = _OPENAI_KEY_RE.sub("[REDACTED_KEY]", s)
    s = _INLINE_KV_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]", s)
    return s


def get_correlation_id() -> str | None:
    return correlation_id_var.get()


def redact_mapping(payload: dict[str, Any]) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for key, value in payload.items():
        if key.lower() in _SENSITIVE_KEYS:
            redacted[key] = "[REDACTED]"
        elif isinstance(value, dict):
            redacted[key] = redact_mapping(value)
        elif isinstance(value, list):
            redacted[key] = [
                redact_mapping(v) if isinstance(v, dict) else redact_text(v) for v in value
            ]
        elif isinstance(value, str):
            # Scrub secrets that leak inside string *values*, not just keys.
            redacted[key] = redact_text(value)
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
