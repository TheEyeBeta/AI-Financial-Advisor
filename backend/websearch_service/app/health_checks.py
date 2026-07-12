"""Liveness and readiness probes for the web search service."""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any

from .routes.search import check_search_provider
from .services.auth import validate_auth_configuration
from .services.rate_limit import rate_limit_readiness_status

READINESS_TIMEOUT_SECONDS = float(os.getenv("READINESS_TIMEOUT_SECONDS", "3"))

_startup_complete = False


def mark_startup_complete() -> None:
    global _startup_complete
    _startup_complete = True


def is_startup_complete() -> bool:
    return _startup_complete


def _check_required_configuration() -> dict[str, Any]:
    missing: list[str] = []
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not (os.getenv(key) or "").strip():
            missing.append(key)

    is_production = (os.getenv("ENVIRONMENT") or "").strip().lower() == "production"
    if is_production:
        for key in ("CORS_ORIGINS", "OPENAI_API_KEY"):
            if not (os.getenv(key) or "").strip():
                missing.append(key)

    try:
        validate_auth_configuration()
    except RuntimeError as exc:
        return {"status": "error", "detail": str(exc)}

    if missing:
        return {"status": "error", "missing": missing}
    return {"status": "ok"}


async def _ping_supabase(timeout: float) -> dict[str, Any]:
    from .services.supabase_client import supabase_client

    def _ping() -> None:
        supabase_client.schema("core").table("users").select("id").limit(1).execute()

    try:
        await asyncio.wait_for(asyncio.to_thread(_ping), timeout=timeout)
        return {"status": "ok"}
    except asyncio.TimeoutError:
        return {"status": "error", "detail": "timeout"}
    except Exception as exc:
        return {"status": "error", "detail": type(exc).__name__}


async def assess_readiness() -> dict[str, Any]:
    """Evaluate readiness. Required deps fail closed; optional deps may degrade."""
    components: dict[str, Any] = {}

    config = _check_required_configuration()
    components["configuration"] = config

    db = await _ping_supabase(timeout=READINESS_TIMEOUT_SECONDS)
    components["database"] = db

    rate_limit = rate_limit_readiness_status()
    components["rate_limit"] = rate_limit

    components["startup"] = {
        "status": "ok" if _startup_complete else "error",
        "detail": None if _startup_complete else "lifespan startup incomplete",
    }

    try:
        search = await asyncio.wait_for(check_search_provider(), timeout=READINESS_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        search = {"status": "timeout", "detail": "search provider probe timed out"}
    except Exception as exc:
        search = {"status": "error", "detail": type(exc).__name__}
    components["search_api"] = {**search, "optional": True}

    required_ok = (
        config.get("status") == "ok"
        and db.get("status") == "ok"
        and rate_limit.get("status") == "ok"
        and _startup_complete
    )

    degraded = search.get("status") not in ("connected", "ok")

    return {
        "status": "ready" if required_ok else "not_ready",
        "ready": required_ok,
        "degraded": degraded,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "components": components,
    }


def liveness_payload() -> dict[str, str]:
    return {"status": "alive", "timestamp": datetime.now(timezone.utc).isoformat()}
