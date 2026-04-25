"""Coverage tests for meridian route error paths in app/routes/ai_proxy.py."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from .conftest import TEST_JWT_SECRET


def _client() -> TestClient:
    return TestClient(create_app())


# ── meridian_onboard exception handler (lines 1944-1946) ─────────────────────

def test_meridian_onboard_exception_returns_500(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "false")

    def _close_task(coro):
        try:
            coro.close()
        except Exception:
            pass
        from unittest.mock import MagicMock
        return MagicMock()

    with patch(
        "app.routes.ai_proxy.run_meridian_onboard",
        new=AsyncMock(side_effect=RuntimeError("db exploded")),
    ):
        resp = _client().post(
            "/api/meridian/onboard",
            json={
                "goal_name": "Retirement",
                "target_amount": 100000.0,
            },
        )
    assert resp.status_code == 500
    assert "Onboarding failed" in resp.json()["detail"]


# ── meridian_refresh_context (lines 1960-1967) ────────────────────────────────

def test_meridian_refresh_context_wrong_user_returns_403(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    # DEV_BYPASS_USER_ID is used when AUTH_REQUIRED=false
    from app.services.auth import DEV_BYPASS_USER_ID

    resp = _client().post(
        "/api/meridian/refresh-context",
        json={"user_id": "some-other-user-id"},
    )
    assert resp.status_code == 403
    assert "Cannot refresh another user" in resp.json()["detail"]


def test_meridian_refresh_context_success(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    from app.services.auth import DEV_BYPASS_USER_ID

    with patch(
        "app.routes.ai_proxy.refresh_iris_context_cache",
        new=AsyncMock(return_value=None),
    ):
        resp = _client().post(
            "/api/meridian/refresh-context",
            json={"user_id": DEV_BYPASS_USER_ID},
        )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_meridian_refresh_context_exception_returns_failure(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    from app.services.auth import DEV_BYPASS_USER_ID

    with patch(
        "app.routes.ai_proxy.refresh_iris_context_cache",
        new=AsyncMock(side_effect=RuntimeError("cache fail")),
    ):
        resp = _client().post(
            "/api/meridian/refresh-context",
            json={"user_id": DEV_BYPASS_USER_ID},
        )
    assert resp.status_code == 200
    assert resp.json()["success"] is False
    assert "cache fail" in resp.json()["error"]


# ── meridian_refresh_all missing/invalid cron secret (lines 1995, 1998) ──────

def test_refresh_all_no_cron_secret_configured_returns_501(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.delenv("MERIDIAN_CRON_SECRET", raising=False)

    resp = _client().post(
        "/api/meridian/refresh-all",
        headers={"x-cron-secret": "anything"},
    )
    assert resp.status_code == 501
    assert "Cron secret not configured" in resp.json()["detail"]


def test_refresh_all_wrong_cron_secret_returns_403(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.setenv("MERIDIAN_CRON_SECRET", "correct-secret")

    resp = _client().post(
        "/api/meridian/refresh-all",
        headers={"x-cron-secret": "wrong-secret"},
    )
    assert resp.status_code == 403
    assert "Invalid cron secret" in resp.json()["detail"]
