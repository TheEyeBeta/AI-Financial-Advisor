"""Tests for admin route handlers — trigger endpoints, scheduler status, health."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.admin import (
    JOB_TYPE_RANKING,
    router as admin_router,
    _require_admin,
    _get_supabase_rest_config,
)

_IDEMPOTENCY_HEADERS = {"Idempotency-Key": "test-idempotency-key-001"}


def _queued_job(job_type: str) -> tuple[dict, bool]:
    return (
        {
            "id": "job-test-1",
            "status": "queued",
            "job_type": job_type,
            "correlation_id": "corr-test-1",
        },
        True,
    )


# ── Test app that skips auth ───────────────────────────────────────────────────

def _app_no_auth() -> FastAPI:
    """Build a minimal FastAPI app with admin router, bypassing auth."""
    app = FastAPI()
    app.include_router(admin_router)
    # Override auth dependency to always pass
    app.dependency_overrides[_require_admin] = lambda: "service-role"
    return app


# ── Trigger routes ─────────────────────────────────────────────────────────────

class TestTriggerRanking:
    def test_returns_started(self):
        with patch(
            "app.routes.admin.enqueue_admin_job",
            return_value=_queued_job(JOB_TYPE_RANKING),
        ):
            client = TestClient(_app_no_auth())
            resp = client.post("/api/admin/trigger-ranking", headers=_IDEMPOTENCY_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["status"] == "queued"

    def test_enqueues_durable_job(self):
        with patch(
            "app.routes.admin.enqueue_admin_job",
            return_value=_queued_job(JOB_TYPE_RANKING),
        ) as enqueue_mock:
            client = TestClient(_app_no_auth())
            client.post("/api/admin/trigger-ranking", headers=_IDEMPOTENCY_HEADERS)
        enqueue_mock.assert_called_once()


class TestTriggerMemoryScan:
    def test_returns_started(self):
        with patch(
            "app.routes.admin.enqueue_admin_job",
            return_value=_queued_job("memory_history_scan"),
        ):
            client = TestClient(_app_no_auth())
            resp = client.post("/api/admin/trigger-memory-scan", headers=_IDEMPOTENCY_HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "queued"
        assert data["limit"] == 200


class TestTriggerIntelligence:
    def test_returns_started(self):
        with patch(
            "app.routes.admin.enqueue_admin_job",
            return_value=_queued_job("intelligence_engine"),
        ):
            client = TestClient(_app_no_auth())
            resp = client.post("/api/admin/trigger-intelligence", headers=_IDEMPOTENCY_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["status"] == "queued"


class TestTriggerMemoryExtraction:
    def test_returns_started(self):
        with patch(
            "app.routes.admin.enqueue_admin_job",
            return_value=_queued_job("memory_extraction"),
        ):
            client = TestClient(_app_no_auth())
            resp = client.post("/api/admin/trigger-memory-extraction", headers=_IDEMPOTENCY_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["status"] == "queued"


class TestTriggerMeridianRefresh:
    def test_returns_started(self):
        with patch(
            "app.routes.admin.enqueue_admin_job",
            return_value=_queued_job("meridian_refresh"),
        ):
            client = TestClient(_app_no_auth())
            resp = client.post("/api/admin/trigger-meridian-refresh", headers=_IDEMPOTENCY_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["status"] == "queued"


class TestAdminJobRoutes:
    def test_list_jobs(self):
        with patch(
            "app.routes.admin.list_admin_jobs",
            return_value=[{"id": "job-1", "status": "queued"}],
        ):
            client = TestClient(_app_no_auth())
            resp = client.get("/api/admin/jobs")
        assert resp.status_code == 200
        assert resp.json()["jobs"][0]["id"] == "job-1"

    def test_get_job_detail(self):
        with patch(
            "app.routes.admin.get_admin_job",
            return_value={"id": "job-1", "status": "failed"},
        ):
            client = TestClient(_app_no_auth())
            resp = client.get("/api/admin/jobs/job-1")
        assert resp.status_code == 200
        assert resp.json()["job"]["status"] == "failed"

    def test_retry_job(self):
        with patch(
            "app.routes.admin.retry_failed_job",
            return_value={"id": "job-2", "status": "queued"},
        ):
            client = TestClient(_app_no_auth())
            resp = client.post("/api/admin/jobs/job-1/retry")
        assert resp.status_code == 200
        assert resp.json()["retried_from"] == "job-1"


# ── Scheduler status ───────────────────────────────────────────────────────────

class TestSchedulerStatus:
    def test_fallback_when_supabase_not_configured(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
        client = TestClient(_app_no_auth())
        resp = client.get("/api/admin/scheduler-status")
        assert resp.status_code == 200
        data = resp.json()
        assert "jobs" in data
        # In fallback mode all last_run values are None
        assert all(j["last_run"] is None for j in data["jobs"])

    def test_with_supabase_configured(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")

        class _FakeResp:
            status_code = 200
            def json(self): return [{"ranked_at": "2026-04-24T01:00:00"}]

        class _FakeClient:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): return False
            async def get(self, *a, **kw): return _FakeResp()

        with patch("app.routes.admin.httpx.AsyncClient", _FakeClient):
            client = TestClient(_app_no_auth())
            resp = client.get("/api/admin/scheduler-status")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["jobs"]) == 4


# ── System health ──────────────────────────────────────────────────────────────

class TestSystemHealth:
    def test_returns_health_dict(self):
        with patch("app.routes.admin._check_supabase", new=AsyncMock(return_value={"status": "connected"})), \
             patch("app.routes.admin._check_dataapi", new=AsyncMock(return_value={"status": "error"})):
            client = TestClient(_app_no_auth())
            resp = client.get("/api/admin/system-health")
        assert resp.status_code == 200
        data = resp.json()
        assert "services" in data
        assert "timestamp" in data
        assert data["overall"] == "degraded"

    def test_all_healthy(self):
        with patch("app.routes.admin._check_supabase", new=AsyncMock(return_value={"status": "connected"})), \
             patch("app.routes.admin._check_dataapi", new=AsyncMock(return_value={"status": "connected"})), \
             patch("app.routes.admin._fetch_dataapi_dashboard", new=AsyncMock(return_value={"charts": []})):
            client = TestClient(_app_no_auth())
            resp = client.get("/api/admin/system-health")
        assert resp.status_code == 200
        assert resp.json()["overall"] == "healthy"

    def test_dashboard_fetch_exception_graceful(self):
        with patch("app.routes.admin._check_supabase", new=AsyncMock(return_value={"status": "connected"})), \
             patch("app.routes.admin._check_dataapi", new=AsyncMock(return_value={"status": "connected"})), \
             patch("app.routes.admin._fetch_dataapi_dashboard", new=AsyncMock(side_effect=Exception("DB down"))):
            client = TestClient(_app_no_auth())
            resp = client.get("/api/admin/system-health")
        assert resp.status_code == 200
        assert "error" in resp.json()["dataapi_dashboard"]


# ── _require_admin edge cases ─────────────────────────────────────────────────

class TestRequireAdminEdgeCases:
    def _mini_app(self):
        app = FastAPI()
        from app.routes.admin import _require_admin
        from fastapi import Request

        @app.get("/test")
        async def test_route(admin: str = _require_admin.__wrapped__ if hasattr(_require_admin, "__wrapped__") else _require_admin):
            return {"ok": True}

        return app

    def test_missing_auth_header_returns_401(self):
        app = FastAPI()
        app.include_router(admin_router)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/api/admin/trigger-ranking")
        assert resp.status_code in (401, 422)

    def test_service_role_jwt_grants_access(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-jwt-secret-for-unit-tests")
        monkeypatch.setenv("AUTH_REQUIRED", "true")

        verify_mock = AsyncMock(return_value={"role": "service_role", "sub": "svc"})
        monkeypatch.setattr("app.routes.admin.verify_service_role", verify_mock)

        with patch(
            "app.routes.admin.enqueue_admin_job",
            return_value=_queued_job(JOB_TYPE_RANKING),
        ):
            app = FastAPI()
            app.include_router(admin_router)
            client = TestClient(app)
            resp = client.post(
                "/api/admin/trigger-ranking",
                headers={"Authorization": "Bearer test-token", **_IDEMPOTENCY_HEADERS},
            )
        assert resp.status_code == 200


# ── _check_supabase helper ─────────────────────────────────────────────────────

class TestCheckSupabase:
    def _fake_http(self, status_code=200):
        resp = MagicMock()
        resp.status_code = status_code
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        return mock_client

    def test_connected_when_url_and_key_set(self, monkeypatch):
        from app.routes.admin import _check_supabase
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
        with patch("app.routes.admin.httpx.AsyncClient", return_value=self._fake_http(200)):
            result = asyncio.run(_check_supabase())
        assert result["status"] == "connected"

    def test_not_configured_when_no_url(self, monkeypatch):
        from app.routes.admin import _check_supabase
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
        result = asyncio.run(_check_supabase())
        assert result["status"] == "not_configured"

    def test_error_on_http_failure(self, monkeypatch):
        from app.routes.admin import _check_supabase
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
        with patch("app.routes.admin.httpx.AsyncClient", return_value=self._fake_http(503)):
            result = asyncio.run(_check_supabase())
        assert result["status"] == "error"

    def test_exception_returns_error(self, monkeypatch):
        from app.routes.admin import _check_supabase
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=Exception("connection refused"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        with patch("app.routes.admin.httpx.AsyncClient", return_value=mock_client):
            result = asyncio.run(_check_supabase())
        assert result["status"] == "error"


# ── _get_supabase_rest_config ──────────────────────────────────────────────────

class TestGetSupabaseRestConfig:
    def test_raises_when_unconfigured(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            _get_supabase_rest_config()

    def test_returns_tuple_when_configured(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
        url, key = _get_supabase_rest_config()
        assert url == "https://test.supabase.co"
        assert key == "test-key"
