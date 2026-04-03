"""Regression tests for admin-route authentication fallback behavior."""

from unittest.mock import AsyncMock

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.routes.admin import _require_admin


def _build_test_app() -> FastAPI:
    app = FastAPI()

    @app.get("/protected")
    async def protected(admin: str = Depends(_require_admin)):
        return {"admin": admin}

    return app


class _FakeResponse:
    def __init__(self, status_code: int, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        return self._body


class _FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str, headers=None, params=None):
        if url.endswith("/auth/v1/user"):
            return _FakeResponse(
                200,
                {"id": "user-123", "email": "admin@example.com"},
            )
        if url.endswith("/rest/v1/users"):
            return _FakeResponse(200, [{"userType": "Admin"}])
        raise AssertionError(f"Unexpected URL requested in test: {url}")


class TestRequireAdmin:
    def test_es256_service_role_jwt_uses_verifier_without_shared_secret(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
        monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
        verify_mock = AsyncMock(return_value={"role": "service_role", "sub": "svc"})
        monkeypatch.setattr("app.routes.admin.verify_service_role", verify_mock)

        client = TestClient(_build_test_app())
        resp = client.get("/protected", headers={"Authorization": "Bearer es256-token"})

        assert resp.status_code == 200
        assert resp.json() == {"admin": "service-role"}
        verify_mock.assert_awaited_once()

    def test_missing_jwt_secret_falls_back_to_admin_user_verification(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
        monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
        monkeypatch.setattr("app.routes.admin.httpx.AsyncClient", _FakeAsyncClient)

        client = TestClient(_build_test_app())
        resp = client.get("/protected", headers={"Authorization": "Bearer user-jwt-token"})

        assert resp.status_code == 200
        assert resp.json() == {"admin": "admin@example.com"}
