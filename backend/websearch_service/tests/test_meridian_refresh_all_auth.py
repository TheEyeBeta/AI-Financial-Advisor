"""Regression tests for Meridian refresh-all authentication."""

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.main import create_app
from .conftest import TEST_JWT_SECRET


def _client() -> TestClient:
    return TestClient(create_app())


def test_refresh_all_accepts_service_role_jwt(monkeypatch, service_role_jwt):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)

    refresh_mock = AsyncMock(return_value={"updated_users": 2, "failed_users": 0})
    monkeypatch.setattr("app.routes.ai_proxy.refresh_all_users_context", refresh_mock)

    response = _client().post(
        "/api/meridian/refresh-all",
        headers={"Authorization": f"Bearer {service_role_jwt}"},
    )

    assert response.status_code == 200
    assert response.json() == {"success": True, "updated_users": 2, "failed_users": 0}
    refresh_mock.assert_awaited_once()


def test_refresh_all_allows_legacy_cron_secret_in_non_production(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.setenv("MERIDIAN_CRON_SECRET", "legacy-secret")

    refresh_mock = AsyncMock(return_value={"updated_users": 1})
    monkeypatch.setattr("app.routes.ai_proxy.refresh_all_users_context", refresh_mock)

    response = _client().post(
        "/api/meridian/refresh-all",
        headers={"x-cron-secret": "legacy-secret"},
    )

    assert response.status_code == 200
    assert response.json() == {"success": True, "updated_users": 1}
    refresh_mock.assert_awaited_once()


def test_refresh_all_rejects_legacy_cron_secret_in_production(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    monkeypatch.setenv("MERIDIAN_CRON_SECRET", "legacy-secret")

    refresh_mock = AsyncMock(return_value={"updated_users": 1})
    monkeypatch.setattr("app.routes.ai_proxy.refresh_all_users_context", refresh_mock)

    response = _client().post(
        "/api/meridian/refresh-all",
        headers={"x-cron-secret": "legacy-secret"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing service-role authentication token."
    refresh_mock.assert_not_awaited()
