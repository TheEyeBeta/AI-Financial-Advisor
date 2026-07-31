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
from .services.ai_budget_guard import ai_budget_readiness_status

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


def release_info() -> dict[str, Any]:
    """Non-sensitive release identity for this running build.

    Lets smoke tests and operators confirm which exact release is serving
    traffic: git SHA, declared version, build timestamp, the Alembic revision
    this build expects, and the environment name. Values come from env vars
    set at deploy time (Railway exposes RAILWAY_GIT_COMMIT_SHA natively;
    GIT_SHA/BUILD_TIMESTAMP may be injected by the build). Absent values are
    reported as null rather than guessed.
    """
    git_sha = (
        (os.getenv("GIT_SHA") or "").strip()
        or (os.getenv("RAILWAY_GIT_COMMIT_SHA") or "").strip()
        or None
    )
    # APP_VERSION is a manually-set Railway variable (or Dockerfile build-arg
    # default) that goes stale on every deploy unless someone updates it by
    # hand. Reuse whichever mechanism already resolved git_sha above — Railway
    # injects this as live container-runtime metadata invisible to the
    # `railway variables` API/CLI, but real inside the process env — so this
    # keeps SHA-as-version (docs/readiness/RELEASE_POLICY.md §3) accurate
    # automatically with no manual/CI step required.
    app_version = (os.getenv("APP_VERSION") or "").strip() or git_sha or None
    build_timestamp = (os.getenv("BUILD_TIMESTAMP") or "").strip() or None
    return {
        "git_sha": git_sha,
        "app_version": app_version,
        "build_timestamp": build_timestamp,
        "expected_schema_revision": expected_schema_revision(),
        "environment": (os.getenv("ENVIRONMENT") or "development").strip().lower()
        or "development",
    }


_expected_revision_cache: str | None = None


def expected_schema_revision() -> str | None:
    """Head revision of the Alembic history shipped with this build (#208)."""
    global _expected_revision_cache
    if _expected_revision_cache is None:
        try:
            from pathlib import Path

            from alembic.config import Config
            from alembic.script import ScriptDirectory

            ini_path = Path(__file__).resolve().parent.parent / "alembic.ini"
            script_dir = ScriptDirectory.from_config(Config(str(ini_path)))
            _expected_revision_cache = script_dir.get_current_head() or ""
        except Exception:
            _expected_revision_cache = ""
    return _expected_revision_cache or None


async def _check_schema_revision(timeout: float) -> dict[str, Any]:
    """Compare the database's alembic_version with the revision this build expects.

    A mismatch means this instance is running against a schema its migrations
    have not been applied to (or is an old build against a newer schema) —
    that instance must not report ready (#208). An unreadable version table
    reports "unknown" without failing readiness, so a permissions quirk cannot
    take production down; the detail stays visible for operators.
    """
    expected = expected_schema_revision()
    if not expected:
        return {"status": "unknown", "detail": "alembic history unavailable in this build"}

    from .services.supabase_client import supabase_client

    def _fetch() -> Any:
        return (
            supabase_client.schema("public")
            .table("alembic_version")
            .select("version_num")
            .limit(1)
            .execute()
        )

    try:
        result = await asyncio.wait_for(asyncio.to_thread(_fetch), timeout=timeout)
        rows = result.data or []
        actual = rows[0].get("version_num") if rows else None
    except asyncio.TimeoutError:
        return {"status": "unknown", "expected": expected, "detail": "timeout"}
    except Exception as exc:
        return {"status": "unknown", "expected": expected, "detail": type(exc).__name__}

    if not isinstance(actual, str) or not actual:
        # Table unreadable/empty or response malformed — inconclusive, not a
        # confirmed mismatch.
        return {"status": "unknown", "expected": expected, "detail": "version row unavailable"}

    if actual == expected:
        return {"status": "ok", "revision": actual}
    return {"status": "error", "expected": expected, "actual": actual}


async def assess_readiness() -> dict[str, Any]:
    """Evaluate readiness. Required deps fail closed; optional deps may degrade."""
    components: dict[str, Any] = {}

    config = _check_required_configuration()
    components["configuration"] = config

    db = await _ping_supabase(timeout=READINESS_TIMEOUT_SECONDS)
    components["database"] = db

    schema = await _check_schema_revision(timeout=READINESS_TIMEOUT_SECONDS)
    components["schema_revision"] = schema

    rate_limit = rate_limit_readiness_status()
    components["rate_limit"] = rate_limit

    ai_budget = ai_budget_readiness_status()
    components["ai_budget_guard"] = ai_budget

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
        # A confirmed schema mismatch fails readiness; "unknown" does not.
        and schema.get("status") != "error"
        and rate_limit.get("status") == "ok"
        and ai_budget.get("status") in ("ok", "degraded")
        and _startup_complete
    )

    degraded = (
        search.get("status") not in ("connected", "ok")
        or schema.get("status") == "unknown"
        or ai_budget.get("status") == "degraded"
    )

    return {
        "status": "ready" if required_ok else "not_ready",
        "ready": required_ok,
        "degraded": degraded,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "release": release_info(),
        "components": components,
    }


def liveness_payload() -> dict[str, str]:
    return {"status": "alive", "timestamp": datetime.now(timezone.utc).isoformat()}
