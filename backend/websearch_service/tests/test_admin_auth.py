"""Tests for admin authentication — service-role JWT replaces X-Admin-Key."""
import time

import jwt as pyjwt
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from app.services.auth import verify_service_role
from .conftest import TEST_JWT_SECRET, _make_jwt


# ---------------------------------------------------------------------------
# Standalone mini-app that only exercises verify_service_role
# ---------------------------------------------------------------------------

def _build_test_app() -> FastAPI:
    app = FastAPI()

    @app.get("/protected")
    async def protected(payload: dict = Depends(verify_service_role)):
        return {"role": payload.get("role"), "sub": payload.get("sub")}

    return app


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestVerifyServiceRole:
    """Unit tests for the verify_service_role dependency."""

    def _client(self) -> TestClient:
        return TestClient(_build_test_app())

    def test_valid_service_role_jwt(self, monkeypatch, service_role_jwt):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
        c = self._client()
        resp = c.get("/protected", headers={"Authorization": f"Bearer {service_role_jwt}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "service_role"
        assert data["sub"] == "test-service"

    def test_missing_token_returns_401(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
        c = self._client()
        resp = c.get("/protected")
        assert resp.status_code == 401

    def test_anon_role_returns_403(self, monkeypatch, anon_role_jwt):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
        c = self._client()
        resp = c.get("/protected", headers={"Authorization": f"Bearer {anon_role_jwt}"})
        assert resp.status_code == 403

    def test_invalid_signature_returns_401(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
        bad_token = pyjwt.encode(
            {"role": "service_role", "iat": int(time.time())},
            "wrong-secret",
            algorithm="HS256",
        )
        c = self._client()
        resp = c.get("/protected", headers={"Authorization": f"Bearer {bad_token}"})
        assert resp.status_code == 401

    def test_expired_token_returns_401(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
        expired_token = pyjwt.encode(
            {"role": "service_role", "iat": int(time.time()) - 7200, "exp": int(time.time()) - 3600},
            TEST_JWT_SECRET,
            algorithm="HS256",
        )
        c = self._client()
        resp = c.get("/protected", headers={"Authorization": f"Bearer {expired_token}"})
        assert resp.status_code == 401

    def test_missing_jwt_secret_returns_500(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
        token = _make_jwt()
        c = self._client()
        resp = c.get("/protected", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 500

    def test_auth_disabled_bypasses_check(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        c = self._client()
        resp = c.get("/protected")
        assert resp.status_code == 200
        assert resp.json()["role"] == "service_role"
