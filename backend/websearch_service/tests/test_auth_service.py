"""Tests for app.services.auth — helper functions and dependency flows."""
from __future__ import annotations

import time
from unittest.mock import patch

import jwt as pyjwt
import pytest
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket
from fastapi.testclient import TestClient

from app.services import auth as auth_mod
from app.services.auth import (
    ASYMMETRIC_JWT_ALGORITHMS,
    AuthenticatedUser,
    DEV_BYPASS_USER_ID,
    HMAC_JWT_ALGORITHMS,
    _environment,
    _extract_bearer_token,
    _extract_websocket_token,
    _get_backend_env,
    _is_production,
    _verify_supabase_jwt,
    get_backend_anon_key,
    get_backend_service_role_key,
    get_backend_supabase_url,
    optional_auth,
    require_auth,
    validate_auth_configuration,
)
from .conftest import TEST_JWT_SECRET


# ─── environment helpers ────────────────────────────────────────────────────

def test_environment_trims_and_lowers(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "  PRODUCTION  ")
    assert _environment() == "production"
    assert _is_production() is True


def test_environment_defaults_to_development(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert _environment() == "development"
    assert _is_production() is False


# ─── _get_backend_env ───────────────────────────────────────────────────────

def test_get_backend_env_prefers_primary(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://primary.example")
    monkeypatch.setenv("VITE_SUPABASE_URL", "https://legacy.example")
    assert get_backend_supabase_url() == "https://primary.example"


def test_get_backend_env_uses_legacy_only_outside_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("VITE_SUPABASE_URL", "https://legacy.example")
    assert get_backend_supabase_url() == "https://legacy.example"


def test_get_backend_env_rejects_legacy_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("VITE_SUPABASE_URL", "https://legacy.example")
    assert get_backend_supabase_url() == ""


def test_service_role_and_anon_getters_work(monkeypatch):
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "srk")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "ank")
    assert get_backend_service_role_key() == "srk"
    assert get_backend_anon_key() == "ank"


# ─── validate_auth_configuration ───────────────────────────────────────────

def test_validate_auth_configuration_rejects_bypass_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    with pytest.raises(RuntimeError, match="AUTH_REQUIRED=false"):
        validate_auth_configuration()


def test_validate_auth_configuration_rejects_vite_srk_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("VITE_SUPABASE_SERVICE_ROLE_KEY", "leaked-srk")
    with pytest.raises(RuntimeError, match="VITE_SUPABASE_SERVICE_ROLE_KEY"):
        validate_auth_configuration()


def test_validate_auth_configuration_passes_in_dev(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    validate_auth_configuration()  # must not raise


# ─── Algorithm classes ─────────────────────────────────────────────────────

def test_hmac_vs_asymmetric_algorithm_sets_are_disjoint():
    assert HMAC_JWT_ALGORITHMS.isdisjoint(ASYMMETRIC_JWT_ALGORITHMS)


# ─── Token extraction ──────────────────────────────────────────────────────

def _req_with_auth(header_value: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [(b"authorization", header_value.encode())],
            "client": ("203.0.113.10", 443),
            "query_string": b"",
            "state": {},
        }
    )


def test_extract_bearer_token_returns_stripped_value():
    req = _req_with_auth("Bearer   abc.def.ghi  ")
    assert _extract_bearer_token(req) == "abc.def.ghi"


def test_extract_bearer_token_returns_none_for_missing_header():
    req = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [],
            "client": ("1.2.3.4", 443),
            "query_string": b"",
            "state": {},
        }
    )
    assert _extract_bearer_token(req) is None


def test_extract_bearer_token_returns_none_for_non_bearer_header():
    req = _req_with_auth("Basic xyz")
    assert _extract_bearer_token(req) is None


def test_extract_bearer_token_returns_none_for_empty_bearer():
    req = _req_with_auth("Bearer  ")
    assert _extract_bearer_token(req) is None


def test_extract_websocket_token_from_header():
    # Build a minimal WebSocket stub with the attributes auth.py relies on.
    class _Stub:
        headers = {"Authorization": "Bearer ws-token"}
        query_params = {}

    assert _extract_websocket_token(_Stub()) == "ws-token"


def test_extract_websocket_token_from_query_param():
    class _Stub:
        headers = {"Authorization": ""}
        query_params = {"token": "query-token"}

    assert _extract_websocket_token(_Stub()) == "query-token"


def test_extract_websocket_token_from_access_token_query_param():
    class _Stub:
        headers = {"Authorization": ""}
        query_params = {"access_token": "access-token"}

    assert _extract_websocket_token(_Stub()) == "access-token"


def test_extract_websocket_token_returns_none_when_absent():
    class _Stub:
        headers = {"Authorization": ""}
        query_params = {}

    assert _extract_websocket_token(_Stub()) is None


# ─── _verify_supabase_jwt routing ───────────────────────────────────────────

def _hs256(secret: str, role: str = "authenticated") -> str:
    return pyjwt.encode(
        {"sub": "u1", "role": role, "iat": int(time.time()), "exp": int(time.time()) + 60},
        secret,
        algorithm="HS256",
    )


def test_verify_supabase_jwt_hs256_with_secret(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "shared-secret-0123456789abcdef-long")
    token = _hs256("shared-secret-0123456789abcdef-long")
    payload = _verify_supabase_jwt(
        token,
        required_claims=("sub", "exp", "iat", "role"),
        allow_rest_fallback=False,
    )
    assert payload["role"] == "authenticated"


def test_verify_supabase_jwt_hs256_falls_back_to_rest_when_secret_absent(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

    token = _hs256("shared-secret")

    with patch.object(
        auth_mod,
        "_verify_jwt_via_supabase_rest",
        return_value={"sub": "u-rest", "email": "u@example.com"},
    ) as rest_mock:
        payload = _verify_supabase_jwt(
            token,
            required_claims=("sub", "exp", "iat", "role"),
            allow_rest_fallback=True,
        )

    assert payload == {"sub": "u-rest", "email": "u@example.com"}
    rest_mock.assert_called_once()


def test_verify_supabase_jwt_hs256_without_secret_and_no_fallback_returns_500(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    token = _hs256("some-secret")
    with pytest.raises(HTTPException) as excinfo:
        _verify_supabase_jwt(
            token,
            required_claims=("role", "iat"),
            allow_rest_fallback=False,
        )
    assert excinfo.value.status_code == 500


def test_verify_supabase_jwt_unsupported_algorithm_returns_401(monkeypatch):
    monkeypatch.setattr(auth_mod, "_jwt_algorithm", lambda token: "NONE")
    with pytest.raises(HTTPException) as excinfo:
        _verify_supabase_jwt(
            "whatever",
            required_claims=("role", "iat"),
            allow_rest_fallback=False,
        )
    assert excinfo.value.status_code == 401


# ─── require_auth / optional_auth via a mini-app ────────────────────────────

def _protected_app() -> FastAPI:
    app = FastAPI()

    @app.get("/me")
    async def me(user: AuthenticatedUser = Depends(require_auth)):
        return {"auth_id": user.auth_id, "email": user.email}

    @app.get("/maybe")
    async def maybe(user=Depends(optional_auth)):
        if user is None:
            return {"user": None}
        return {"user": user.auth_id}

    return app


def test_require_auth_rejects_missing_token(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    client = TestClient(_protected_app())
    resp = client.get("/me")
    assert resp.status_code == 401
    assert "token" in resp.json()["detail"].lower()


def test_require_auth_rejects_token_without_sub_claim(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)

    # Issue a token with no `sub` — PyJWT will still require the claim,
    # so this will come back as a 401 from the required-claims check.
    token = pyjwt.encode(
        {"role": "authenticated", "iat": int(time.time()), "exp": int(time.time()) + 60},
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    client = TestClient(_protected_app())
    resp = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_require_auth_dev_bypass_returns_known_uuid(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    monkeypatch.setenv("ENVIRONMENT", "development")
    client = TestClient(_protected_app())
    resp = client.get("/me")
    assert resp.status_code == 200
    assert resp.json()["auth_id"] == DEV_BYPASS_USER_ID


def test_require_auth_accepts_valid_hs256_token(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    token = pyjwt.encode(
        {
            "sub": "user-42",
            "role": "authenticated",
            "email": "u@test.local",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    client = TestClient(_protected_app())
    resp = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"auth_id": "user-42", "email": "u@test.local"}


def test_optional_auth_returns_none_when_missing(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    client = TestClient(_protected_app())
    resp = client.get("/maybe")
    assert resp.status_code == 200
    assert resp.json() == {"user": None}


def test_optional_auth_returns_user_when_token_valid(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    token = pyjwt.encode(
        {
            "sub": "alpha",
            "role": "authenticated",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    client = TestClient(_protected_app())
    resp = client.get("/maybe", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"user": "alpha"}
