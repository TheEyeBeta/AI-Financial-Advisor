"""Admin system health routes.

Proxies requests to TheEyeBetaDataAPI admin endpoints so the frontend
admin page can display connection status, table counts, engine worker
heartbeats, and run read-only queries against the engine database.

**Authentication**: Every route in this module requires either:
  1. A valid Supabase JWT (Authorization: Bearer <token>) from a user
     whose ``userType`` is ``'Admin'`` in the ``core.users`` table, OR
  2. A Supabase **service-role JWT** (Authorization: Bearer <token>)
     whose ``role`` claim is ``service_role`` (for automated/CI access).
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..services.auth import (
    get_backend_service_role_key,
    get_backend_supabase_url,
    verify_service_role,
)
from ..services.dataapi_client import get_dataapi_client
from ..services.intelligence_engine import run_intelligence_cycle
from ..services.memory_agent import run_history_scan, run_memory_extraction_cycle
from ..services.meridian_context import refresh_all_users_context
from ..services.ranking_engine import run_ranking_cycle

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ---------------------------------------------------------------------------
# Authentication dependency
# ---------------------------------------------------------------------------

async def _require_admin(request: Request) -> str:
    """Validate that the caller is an authenticated admin.

    Supports two mechanisms (checked in order):
      1. ``Authorization: Bearer <service-role-jwt>`` — a Supabase
         service-role JWT verified locally via ``SUPABASE_JWT_SECRET`` for
         legacy symmetric tokens or via Supabase JWKS for modern asymmetric
         tokens. Grants immediate access when the ``role`` claim is
         ``service_role``.
      2. ``Authorization: Bearer <user-jwt>`` — the JWT is verified
         against Supabase, and the corresponding user must have
         ``userType = 'Admin'`` in ``core.users``.

    Returns the authenticated principal identifier (email or "service-role").
    Raises ``HTTPException(401/403)`` on failure.
    """
    auth_header = (request.headers.get("Authorization") or "").strip()
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing authentication. Provide Authorization: Bearer <token> header.",
        )

    # --- Try service-role JWT first (fast local/JWKS verification) ---
    jwt_secret = (os.getenv("SUPABASE_JWT_SECRET") or "").strip()
    supabase_url = get_backend_supabase_url()
    if jwt_secret or supabase_url:
        try:
            payload = await verify_service_role(request)
            logger.info("Admin access granted via service-role JWT")
            return "service-role"
        except HTTPException as exc:
            # Token present but role != service_role or signature invalid —
            # fall through to the user-JWT path below.
            if exc.status_code in (401, 403):
                pass
            else:
                raise
    else:
        logger.info(
            "Neither SUPABASE_JWT_SECRET nor SUPABASE_URL is configured; "
            "skipping service-role JWT verification and falling back to "
            "user-JWT admin verification."
        )

    # --- Fallback: Supabase user JWT with admin check ---
    token = auth_header[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty bearer token")

    supabase_key = get_backend_service_role_key()
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="Supabase not configured on backend")

    # Verify the JWT by calling Supabase auth.getUser
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.get(
                f"{supabase_url}/auth/v1/user",
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {token}",
                },
            )
    except Exception as exc:
        logger.warning("Supabase auth request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to verify token with Supabase") from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired Supabase token")

    user_data = resp.json()
    user_id = user_data.get("id")
    user_email = user_data.get("email", "unknown")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token did not resolve to a user")

    # Check admin status in core.users table
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.get(
                f"{supabase_url}/rest/v1/users",
                params={"auth_id": f"eq.{user_id}", "select": "userType"},
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",  # service role for RLS bypass
                    "Accept-Profile": "core",
                },
            )
    except Exception as exc:
        logger.warning("Supabase user lookup failed: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to verify admin status") from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"User lookup failed: HTTP {resp.status_code}")

    rows = resp.json()
    if not rows:
        raise HTTPException(status_code=403, detail="User profile not found")

    user_type = rows[0].get("userType")
    if user_type != "Admin":
        logger.warning("Non-admin user %s (type=%s) attempted admin access", user_email, user_type)
        raise HTTPException(status_code=403, detail="Admin access required")

    logger.info("Admin access granted to %s", user_email)
    return user_email


async def _get_admin_token() -> tuple[str, str]:
    """Get an admin-scoped DataAPI token.

    Uses dedicated DATAAPI_ADMIN_* credentials if set,
    otherwise falls back to the default DataAPIClient credentials.
    """
    client = get_dataapi_client()
    base_url = os.getenv("DATAAPI_ADMIN_URL") or client.base_url
    client_id = os.getenv("DATAAPI_ADMIN_CLIENT_ID") or os.getenv("DATAAPI_CLIENT_ID", "")
    client_secret = os.getenv("DATAAPI_ADMIN_CLIENT_SECRET") or os.getenv("DATAAPI_CLIENT_SECRET", "")

    if not base_url or not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="DataAPI admin credentials not configured")

    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.post(
            f"{base_url}/api/v1/auth/service-token",
            auth=(client_id, client_secret),
            json={"requested_scopes": []},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"DataAPI auth failed: {resp.status_code}")
        body = resp.json()
    return base_url, body["access_token"]


@router.get("/api/admin/system-health")
async def system_health(admin: str = Depends(_require_admin)) -> dict[str, Any]:
    """Return comprehensive system health across all services."""
    results: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {},
    }

    # 1. Check Supabase
    supabase_status = await _check_supabase()
    results["services"]["supabase"] = supabase_status

    # 2. Check DataAPI
    dataapi_status = await _check_dataapi()
    results["services"]["dataapi"] = dataapi_status

    # 3. Check this backend itself
    results["services"]["backend"] = {
        "status": "connected",
        "uptime_seconds": round(time.time() - _start_time, 2),
    }

    # 4. If DataAPI is connected, fetch dashboard data
    if dataapi_status.get("status") == "connected":
        try:
            dashboard = await _fetch_dataapi_dashboard()
            results["dataapi_dashboard"] = dashboard
        except Exception as exc:
            logger.warning("Failed to fetch DataAPI dashboard: %s", exc)
            results["dataapi_dashboard"] = {"error": str(exc)}

    # Overall status
    statuses = [s.get("status") for s in results["services"].values()]
    if all(s == "connected" for s in statuses):
        results["overall"] = "healthy"
    elif any(s == "connected" for s in statuses):
        results["overall"] = "degraded"
    else:
        results["overall"] = "down"

    return results


@router.get("/api/admin/dataapi-query")
async def dataapi_query(
    q: str = Query(min_length=1, max_length=2000),
    limit: int = Query(default=100, ge=1, le=1000),
    admin: str = Depends(_require_admin),
) -> dict[str, Any]:
    """Proxy a read-only SQL query to the DataAPI admin endpoint."""
    normalized = q.lstrip().lower()
    if not normalized.startswith("select"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are permitted")

    # Wrap with an outer LIMIT 1000 to enforce a hard row cap at the SQL level.
    wrapped = f"SELECT * FROM ({q}) AS _q LIMIT 1000"
    # Prepend a per-query statement timeout; SET LOCAL confines it to this transaction.
    final_sql = f"SET LOCAL statement_timeout = '5000'; {wrapped}"

    try:
        base_url, token = await _get_admin_token()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DataAPI auth error: {exc}") from exc

    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            resp = await http.get(
                f"{base_url}/api/v1/admin/query",
                params={"q": final_sql, "limit": limit},
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code != 200:
                error_body = resp.text
                raise HTTPException(status_code=resp.status_code, detail=f"DataAPI query error: {error_body}")
            result = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"DataAPI request failed: {exc}") from exc

    logger.info(
        "admin_dataapi_query admin=%s query=%r timestamp=%s",
        admin,
        q,
        datetime.now(timezone.utc).isoformat(),
    )
    return result


@router.post("/api/admin/trigger-ranking")
async def trigger_ranking(admin: str = Depends(_require_admin)) -> dict[str, Any]:
    """Manually trigger a ranking cycle in the background and return immediately."""
    asyncio.create_task(run_ranking_cycle())
    logger.info("Admin %s triggered ranking cycle in background", admin)
    return {"status": "started"}


@router.post("/api/admin/trigger-memory-scan")
async def trigger_memory_scan(admin: str = Depends(_require_admin)) -> dict[str, Any]:
    """Manually trigger a full history memory scan in the background and return immediately."""
    asyncio.create_task(run_history_scan(limit=200))
    logger.info("Admin %s triggered memory history scan (limit=200) in background", admin)
    return {"status": "started", "limit": 200}


@router.post("/api/admin/trigger-intelligence")
async def trigger_intelligence(admin: str = Depends(_require_admin)) -> dict[str, Any]:
    """Manually trigger an intelligence cycle in the background and return immediately."""
    asyncio.create_task(run_intelligence_cycle())
    logger.info("Admin %s triggered intelligence cycle in background", admin)
    return {"status": "started"}


@router.post("/api/admin/trigger-memory-extraction")
async def trigger_memory_extraction(admin: str = Depends(_require_admin)) -> dict[str, Any]:
    """Manually trigger a live memory extraction cycle in the background and return immediately."""
    asyncio.create_task(run_memory_extraction_cycle())
    logger.info("Admin %s triggered memory extraction cycle in background", admin)
    return {"status": "started"}


@router.post("/api/admin/trigger-meridian-refresh")
async def trigger_meridian_refresh(admin: str = Depends(_require_admin)) -> dict[str, Any]:
    """Manually trigger a Meridian context refresh for all users in the background."""
    asyncio.create_task(refresh_all_users_context())
    logger.info("Admin %s triggered Meridian context refresh in background", admin)
    return {"status": "started"}


@router.get("/api/admin/scheduler-status")
async def scheduler_status(admin: str = Depends(_require_admin)) -> dict[str, Any]:
    """Return last-run timestamps for each scheduled job, inferred from the database.

    Never raises — always returns a valid response even if all DB queries fail.
    """
    _fallback_jobs = [
        {"id": "ranking", "name": "Ranking Engine", "schedule": "Daily at 01:00 UTC", "last_run": None, "status": "unknown"},
        {"id": "memory_extraction", "name": "Memory Extraction", "schedule": "Every 15 minutes", "last_run": None, "status": "unknown"},
        {"id": "intelligence", "name": "Intelligence Engine", "schedule": "Every 6 hours", "last_run": None, "status": "unknown"},
        {"id": "meridian_refresh", "name": "Meridian Context", "schedule": "On demand / cache miss", "last_run": None, "status": "unknown"},
    ]

    try:
        base_url, service_role_key = _get_supabase_rest_config()
    except HTTPException:
        return {"jobs": _fallback_jobs}

    async def _query_last(schema: str, table: str, column: str) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=10.0) as http:
                resp = await http.get(
                    f"{base_url}/rest/v1/{table}",
                    params={"select": column, "order": f"{column}.desc", "limit": "1"},
                    headers={
                        "apikey": service_role_key,
                        "Authorization": f"Bearer {service_role_key}",
                        "Accept-Profile": schema,
                    },
                )
            if resp.status_code < 400:
                data = resp.json()
                return data[0].get(column) if data else None
        except Exception as exc:
            logger.warning("scheduler-status query failed (%s.%s.%s): %s", schema, table, column, exc)
        return None

    ranking_last, memory_last, intelligence_last, meridian_last = await asyncio.gather(
        _query_last("market", "trending_stocks", "ranked_at"),
        _query_last("meridian", "user_insights", "extracted_at"),
        _query_last("meridian", "intelligence_digests", "created_at"),
        _query_last("ai", "iris_context_cache", "updated_at"),
    )

    return {
        "jobs": [
            {"id": "ranking", "name": "Ranking Engine", "schedule": "Daily at 01:00 UTC", "last_run": ranking_last, "status": "ok"},
            {"id": "memory_extraction", "name": "Memory Extraction", "schedule": "Every 15 minutes", "last_run": memory_last, "status": "ok"},
            {"id": "intelligence", "name": "Intelligence Engine", "schedule": "Every 6 hours", "last_run": intelligence_last, "status": "ok"},
            {"id": "meridian_refresh", "name": "Meridian Context", "schedule": "On demand / cache miss", "last_run": meridian_last, "status": "ok"},
        ]
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_start_time = time.time()


async def _check_supabase() -> dict[str, Any]:
    """Check Supabase connectivity."""
    url = get_backend_supabase_url()
    key = get_backend_service_role_key()
    if not url or not key:
        return {"status": "not_configured", "message": "Supabase credentials not set"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.get(
                f"{url}/rest/v1/",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
            )
            if resp.status_code < 400:
                return {"status": "connected", "url": url}
            return {"status": "error", "message": f"HTTP {resp.status_code}"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _get_supabase_rest_config() -> tuple[str, str]:
    url = get_backend_supabase_url()
    key = get_backend_service_role_key()
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase credentials not configured")
    return url.rstrip("/"), key


def _parse_count(resp: httpx.Response) -> int:
    content_range = resp.headers.get("content-range", "")
    if "/" not in content_range:
        return 0

    _, total = content_range.rsplit("/", 1)
    try:
        return int(total)
    except ValueError:
        return 0


async def _fetch_ai_table_count(table: str, params: dict[str, str] | None = None) -> int:
    base_url, service_role_key = _get_supabase_rest_config()
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Accept-Profile": "ai",
        "Prefer": "count=exact",
    }

    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.head(
            f"{base_url}/rest/v1/{table}",
            params={"select": "id", **(params or {})},
            headers=headers,
        )

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Supabase count query failed: HTTP {resp.status_code}")

    return _parse_count(resp)


async def _fetch_recent_ai_activity(limit: int = 10) -> list[dict[str, Any]]:
    base_url, service_role_key = _get_supabase_rest_config()
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Accept-Profile": "ai",
    }

    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.get(
            f"{base_url}/rest/v1/chat_messages",
            params={
                "select": "id,user_id,role,created_at",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            headers=headers,
        )

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Supabase recent activity query failed: HTTP {resp.status_code}")

    return resp.json()


@router.get("/api/admin/chat-dashboard")
async def chat_dashboard(admin: str = Depends(_require_admin)) -> dict[str, Any]:
    today = datetime.now(timezone.utc).date().isoformat()

    total_chats, total_messages, active_today, recent_messages = await _gather_chat_dashboard(today)

    return {
        "totalChats": total_chats,
        "totalMessages": total_messages,
        "activeToday": active_today,
        "recentActivity": [
            {
                "id": msg["id"],
                "user_email": "User",
                "action": "Sent message" if msg.get("role") == "user" else "Received AI response",
                "timestamp": msg["created_at"],
            }
            for msg in recent_messages
        ],
    }


async def _gather_chat_dashboard(today: str) -> tuple[int, int, int, list[dict[str, Any]]]:
    total_chats, total_messages, active_today, recent_messages = await asyncio.gather(
        _fetch_ai_table_count("chats"),
        _fetch_ai_table_count("chat_messages"),
        _fetch_ai_table_count("chats", {"updated_at": f"gte.{today}"}),
        _fetch_recent_ai_activity(),
    )
    return total_chats, total_messages, active_today, recent_messages


async def _check_dataapi() -> dict[str, Any]:
    """Check DataAPI connectivity."""
    client = get_dataapi_client()
    if not client.is_configured:
        return {"status": "not_configured", "message": "DataAPI not enabled or credentials missing"}

    try:
        health = await client.check_health()
        return {
            "status": "connected",
            "database": health.get("database", False),
            "api_status": health.get("status", "unknown"),
            "url": client.base_url,
        }
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


async def _fetch_dataapi_dashboard() -> dict[str, Any]:
    """Fetch full dashboard data from the DataAPI admin endpoint."""
    base_url, token = await _get_admin_token()

    async with httpx.AsyncClient(timeout=20.0) as http:
        resp = await http.get(
            f"{base_url}/api/v1/admin/dashboard-data",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
    return resp.json()
