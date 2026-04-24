"""Tests for admin trigger endpoints — auth guard and background dispatch."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routes import admin as admin_route
from .conftest import TEST_JWT_SECRET


def _service_role_app_and_client(monkeypatch) -> TestClient:
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    return TestClient(create_app())


def _service_role_headers(service_role_jwt) -> dict[str, str]:
    return {"Authorization": f"Bearer {service_role_jwt}"}


# ─── Auth guard: endpoints reject missing tokens ───────────────────────────

@pytest.mark.parametrize(
    "endpoint",
    [
        "/api/admin/trigger-ranking",
        "/api/admin/trigger-memory-scan",
        "/api/admin/trigger-intelligence",
        "/api/admin/trigger-memory-extraction",
        "/api/admin/trigger-meridian-refresh",
    ],
)
def test_trigger_endpoints_reject_missing_token(monkeypatch, endpoint: str):
    client = _service_role_app_and_client(monkeypatch)
    resp = client.post(endpoint)
    assert resp.status_code in (401, 403)


# ─── Service-role trigger endpoints ────────────────────────────────────────

async def _noop_coroutine() -> dict:
    """Coroutine that resolves immediately without doing work."""
    return {"ok": True}


def _consume(coro):
    """Close the coroutine so pytest's resource warnings stay clean."""
    coro.close()


def test_trigger_ranking_dispatches_background_task(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)

    ranking_mock = MagicMock(side_effect=lambda *a, **kw: _noop_coroutine())
    with patch.object(admin_route, "run_ranking_cycle", new=ranking_mock), \
         patch.object(admin_route.asyncio, "create_task", side_effect=_consume) as ct_mock:
        resp = client.post(
            "/api/admin/trigger-ranking", headers=_service_role_headers(service_role_jwt),
        )

    assert resp.status_code == 200
    assert resp.json() == {"status": "started"}
    ranking_mock.assert_called_once()
    ct_mock.assert_called_once()


def test_trigger_memory_scan_uses_200_limit(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)

    scan_mock = MagicMock(side_effect=lambda *a, **kw: _noop_coroutine())
    with patch.object(admin_route, "run_history_scan", new=scan_mock), \
         patch.object(admin_route.asyncio, "create_task", side_effect=_consume):
        resp = client.post(
            "/api/admin/trigger-memory-scan", headers=_service_role_headers(service_role_jwt),
        )

    assert resp.status_code == 200
    assert resp.json() == {"status": "started", "limit": 200}
    scan_mock.assert_called_once_with(limit=200)


def test_trigger_intelligence_dispatches_task(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)

    cycle_mock = MagicMock(side_effect=lambda *a, **kw: _noop_coroutine())
    with patch.object(admin_route, "run_intelligence_cycle", new=cycle_mock), \
         patch.object(admin_route.asyncio, "create_task", side_effect=_consume):
        resp = client.post(
            "/api/admin/trigger-intelligence", headers=_service_role_headers(service_role_jwt),
        )

    assert resp.status_code == 200
    cycle_mock.assert_called_once()


def test_trigger_memory_extraction_dispatches_task(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)

    cycle_mock = MagicMock(side_effect=lambda *a, **kw: _noop_coroutine())
    with patch.object(admin_route, "run_memory_extraction_cycle", new=cycle_mock), \
         patch.object(admin_route.asyncio, "create_task", side_effect=_consume):
        resp = client.post(
            "/api/admin/trigger-memory-extraction",
            headers=_service_role_headers(service_role_jwt),
        )

    assert resp.status_code == 200
    cycle_mock.assert_called_once()


def test_trigger_meridian_refresh_dispatches_task(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)

    refresh_mock = MagicMock(side_effect=lambda *a, **kw: _noop_coroutine())
    with patch.object(admin_route, "refresh_all_users_context", new=refresh_mock), \
         patch.object(admin_route.asyncio, "create_task", side_effect=_consume):
        resp = client.post(
            "/api/admin/trigger-meridian-refresh",
            headers=_service_role_headers(service_role_jwt),
        )

    assert resp.status_code == 200
    refresh_mock.assert_called_once()


# ─── Admin dataapi-query input validation ─────────────────────────────────

def test_dataapi_query_rejects_non_select(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)
    resp = client.get(
        "/api/admin/dataapi-query",
        params={"q": "DELETE FROM trades"},
        headers=_service_role_headers(service_role_jwt),
    )
    assert resp.status_code == 400


def test_dataapi_query_rejects_mutation_keywords_inside_cte(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)
    resp = client.get(
        "/api/admin/dataapi-query",
        params={"q": "WITH x AS (DELETE FROM trades) SELECT * FROM x"},
        headers=_service_role_headers(service_role_jwt),
    )
    # Blocked by the keyword regex (DELETE present).
    assert resp.status_code == 400


def test_dataapi_query_requires_min_length(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)
    resp = client.get(
        "/api/admin/dataapi-query",
        params={"q": ""},
        headers=_service_role_headers(service_role_jwt),
    )
    # FastAPI rejects empty query string via min_length=1.
    assert resp.status_code == 422
