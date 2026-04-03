"""Tests for admin authentication — service-role JWT replaces X-Admin-Key."""
import time

import jwt as pyjwt
import pytest
from fastapi import FastAPI, Depends, HTTPException
from fastapi.testclient import TestClient

from app.services.auth import _verify_supabase_jwt, verify_service_role
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

    def test_es256_service_role_jwt_uses_supabase_jwks(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
        monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
        monkeypatch.setattr("app.services.auth._jwt_algorithm", lambda token: "ES256")

        def _fake_verify(token: str, algorithm: str, *, required_claims):
            assert token == "not-a-real-jwt"
            assert algorithm == "ES256"
            assert tuple(required_claims) == ("role", "iat")
            return {"role": "service_role", "sub": "test-service"}

        monkeypatch.setattr("app.services.auth._verify_jwt_with_supabase_jwks", _fake_verify)

        c = self._client()
        resp = c.get("/protected", headers={"Authorization": "Bearer not-a-real-jwt"})

        assert resp.status_code == 200
        assert resp.json() == {"role": "service_role", "sub": "test-service"}

    def test_es256_user_jwt_falls_back_to_supabase_rest_when_jwks_unavailable(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
        monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
        monkeypatch.setenv("SUPABASE_ANON_KEY", "test-anon-key")
        monkeypatch.setattr("app.services.auth._jwt_algorithm", lambda token: "ES256")

        def _jwks_failure(token: str, algorithm: str, *, required_claims):
            raise HTTPException(status_code=503, detail="Authentication service unavailable.")

        monkeypatch.setattr("app.services.auth._verify_jwt_with_supabase_jwks", _jwks_failure)
        monkeypatch.setattr(
            "app.services.auth._verify_jwt_via_supabase_rest",
            lambda token: {"sub": "user-123", "email": "user@example.com", "role": "authenticated"},
        )

        payload = _verify_supabase_jwt(
            "not-a-real-jwt",
            required_claims=("sub", "exp", "iat", "role"),
            allow_rest_fallback=True,
        )

        assert payload == {"sub": "user-123", "email": "user@example.com", "role": "authenticated"}

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
