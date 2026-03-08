"""Admin system health routes.

Proxies requests to TheEyeBetaDataAPI admin endpoints so the frontend
admin page can display connection status, table counts, engine worker
heartbeats, and run read-only queries against the engine database.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..services.dataapi_client import get_dataapi_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


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

    import httpx
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
async def system_health() -> dict[str, Any]:
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
) -> dict[str, Any]:
    """Proxy a read-only SQL query to the DataAPI admin endpoint."""
    try:
        base_url, token = await _get_admin_token()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DataAPI auth error: {exc}") from exc

    import httpx
    try:
        async with httpx.AsyncClient(timeout=30.0) as http:
            resp = await http.get(
                f"{base_url}/api/v1/admin/query",
                params={"q": q, "limit": limit},
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code != 200:
                error_body = resp.text
                raise HTTPException(status_code=resp.status_code, detail=f"DataAPI query error: {error_body}")
            return resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"DataAPI request failed: {exc}") from exc


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_start_time = time.time()


async def _check_supabase() -> dict[str, Any]:
    """Check Supabase connectivity."""
    url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
        or ""
    )
    if not url or not key:
        return {"status": "not_configured", "message": "Supabase credentials not set"}

    try:
        import httpx
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

    import httpx
    async with httpx.AsyncClient(timeout=20.0) as http:
        resp = await http.get(
            f"{base_url}/api/v1/admin/dashboard-data",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
    return resp.json()
