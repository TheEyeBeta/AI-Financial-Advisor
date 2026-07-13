"""Initialize production observability (Sentry, release tags)."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def init_observability() -> None:
    """Configure backend exception tracking when SENTRY_DSN is set."""
    dsn = (os.getenv("SENTRY_DSN") or "").strip()
    if not dsn:
        logger.info("Sentry disabled — SENTRY_DSN not set")
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        logger.warning("sentry-sdk not installed — skipping Sentry init")
        return

    environment = (os.getenv("ENVIRONMENT") or "development").strip().lower()
    release = (os.getenv("APP_VERSION") or "unknown").strip()

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        integrations=[
            FastApiIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        send_default_pii=False,
        before_send=_scrub_event,
    )
    logger.info("Sentry initialized for environment=%s release=%s", environment, release)


def _scrub_event(event: dict, _hint: dict) -> dict | None:
    request = event.get("request") or {}
    headers = request.get("headers") or {}
    for key in list(headers.keys()):
        if key.lower() in {"authorization", "cookie", "x-api-key"}:
            headers[key] = "[REDACTED]"
    request["headers"] = headers
    event["request"] = request
    return event
