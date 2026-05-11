"""Tests for auth.py helper functions and dependencies."""
from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import jwt as pyjwt
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.testclient import TestClient

from app.services.auth import (
    AuthenticatedUser,
    _auth_required,
    _extract_bearer_token,
    _extract_websocket_token,
    _get_backend_env,
    _get_jwt_secret,
    _is_production,
    _jwt_algorithm,
    _verify_jwt_via_supabase_rest,
    _verify_jwt_with_secret,
    _verify_jwt_with_supabase_jwks,
    _verify_supabase_jwt,
    get_backend_anon_key,
    get_backend_service_role_key,
    get_backend_supabase_url,
    optional_auth,
    require_auth,
    require_websocket_auth,
    validate_auth_configuration,
    verify_service_role,
)

TEST_SECRET = "test-jwt-secret-for-auth-tests-32bytes"


def _jwt(role: str = "authenticated", sub: str = "test-user-id", **extra) -> str:
    payload = {
        "role": role,
        "sub": sub,
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
        **extra,
    }
    return pyjwt.encode(payload, TEST_SECRET, algorithm="HS256")


def _http_request(headers: dict | None = None) -> Request:
    hdr = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/test",
        "query_string": b"",
        "headers": hdr,
        "client": ("127.0.0.1", 80),
    })


# ── Environment helpers ────────────────────────────────────────────────────────

class TestEnvironmentHelpers:
    def test_is_production_true(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        assert _is_production() is True

    def test_is_production_false(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "development")
        assert _is_production() is False

    def test_auth_required_true_by_default(self, monkeypatch):
        monkeypatch.delenv("AUTH_REQUIRED", raising=False)
        monkeypatch.setenv("ENVIRONMENT", "development")
        assert _auth_required() is True

    def test_auth_required_disabled_in_dev(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        monkeypatch.setenv("ENVIRONMENT", "development")
        assert _auth_required() is False

    def test_auth_required_always_true_in_production(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        monkeypatch.setenv("ENVIRONMENT", "production")
        assert _auth_required() is True


class TestGetBackendEnv:
    def test_primary_takes_priority(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://primary.supabase.co")
        monkeypatch.setenv("VITE_SUPABASE_URL", "https://legacy.supabase.co")
        assert get_backend_supabase_url() == "https://primary.supabase.co"

    def test_legacy_fallback_in_dev(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.setenv("VITE_SUPABASE_URL", "https://legacy.supabase.co")
        monkeypatch.setenv("ENVIRONMENT", "development")
        assert get_backend_supabase_url() == "https://legacy.supabase.co"

    def test_legacy_not_used_in_production(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.setenv("VITE_SUPABASE_URL", "https://legacy.supabase.co")
        monkeypatch.setenv("ENVIRONMENT", "production")
        assert get_backend_supabase_url() == ""

    def test_get_backend_service_role_key(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc-key")
        assert get_backend_service_role_key() == "svc-key"

    def test_get_backend_anon_key(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
        assert get_backend_anon_key() == "anon-key"


class TestValidateAuthConfig:
    def test_non_production_always_passes(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "development")
        validate_auth_configuration()  # no raise

    def test_production_auth_required_false_raises(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        with pytest.raises(RuntimeError, match="AUTH_REQUIRED=false"):
            validate_auth_configuration()

    def test_production_with_vite_key_raises(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.delenv("AUTH_REQUIRED", raising=False)
        monkeypatch.setenv("VITE_SUPABASE_SERVICE_ROLE_KEY", "some-key")
        with pytest.raises(RuntimeError, match="VITE_SUPABASE_SERVICE_ROLE_KEY"):
            validate_auth_configuration()


# ── Token extraction ───────────────────────────────────────────────────────────

class TestExtractBearerToken:
    def test_valid_bearer(self):
        req = _http_request({"Authorization": "Bearer my-token-123"})
        assert _extract_bearer_token(req) == "my-token-123"

    def test_no_auth_header(self):
        req = _http_request()
        assert _extract_bearer_token(req) is None

    def test_not_bearer_scheme(self):
        req = _http_request({"Authorization": "Basic abc123"})
        assert _extract_bearer_token(req) is None

    def test_bearer_with_empty_token(self):
        req = _http_request({"Authorization": "Bearer "})
        assert _extract_bearer_token(req) is None


class TestExtractWebsocketToken:
    def _ws(self, headers: dict | None = None, query: str = "") -> MagicMock:
        ws = MagicMock()
        ws.headers = headers or {}
        params = {}
        if query:
            for part in query.split("&"):
                k, _, v = part.partition("=")
                params[k] = v
        ws.query_params = params
        return ws

    def test_from_auth_header(self):
        ws = self._ws(headers={"Authorization": "Bearer ws-token"})
        assert _extract_websocket_token(ws) == "ws-token"

    def test_from_token_query_param(self):
        ws = self._ws(query="token=my-ws-token")
        assert _extract_websocket_token(ws) == "my-ws-token"

    def test_from_access_token_query_param(self):
        ws = self._ws(query="access_token=my-access-token")
        assert _extract_websocket_token(ws) == "my-access-token"

    def test_no_token_returns_none(self):
        ws = self._ws()
        assert _extract_websocket_token(ws) is None


# ── JWT verification ───────────────────────────────────────────────────────────

class TestVerifyJwtWithSecret:
    def test_valid_token_returns_payload(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        token = _jwt(role="authenticated", sub="user-123")
        payload = _verify_jwt_with_secret(
            token, TEST_SECRET, "HS256",
            required_claims=("sub", "exp", "iat", "role"),
        )
        assert payload["sub"] == "user-123"

    def test_wrong_secret_raises_401(self):
        token = _jwt()
        with pytest.raises(HTTPException) as exc_info:
            _verify_jwt_with_secret(
                token, "wrong-secret-that-is-long-enough",
                "HS256", required_claims=("sub",),
            )
        assert exc_info.value.status_code == 401

    def test_malformed_token_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            _verify_jwt_with_secret(
                "not.a.token", TEST_SECRET,
                "HS256", required_claims=("sub",),
            )
        assert exc_info.value.status_code == 401


class TestGetJwtSecret:
    def test_returns_secret_when_set(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", "my-secret")
        assert _get_jwt_secret() == "my-secret"

    def test_returns_none_when_not_set(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
        assert _get_jwt_secret() is None


class TestJwtAlgorithm:
    def test_extracts_hs256(self):
        token = _jwt()
        assert _jwt_algorithm(token) == "HS256"

    def test_malformed_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            _jwt_algorithm("notajwt")
        assert exc_info.value.status_code == 401


class TestVerifyJwtViaSuperbaseRest:
    # httpx is imported locally inside _verify_jwt_via_supabase_rest, so we
    # patch the top-level httpx module (not app.services.auth.httpx).

    def test_returns_user_data_on_200(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "user-123", "email": "test@example.com"}

        with patch("httpx.get", return_value=mock_resp):
            result = _verify_jwt_via_supabase_rest("valid-token")
        assert result["sub"] == "user-123"
        assert result["email"] == "test@example.com"

    def test_401_raises_http_exception(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

        mock_resp = MagicMock()
        mock_resp.status_code = 401

        with patch("httpx.get", return_value=mock_resp):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_via_supabase_rest("expired-token")
        assert exc_info.value.status_code == 401

    def test_non_200_non_401_raises_401(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

        mock_resp = MagicMock()
        mock_resp.status_code = 500

        with patch("httpx.get", return_value=mock_resp):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_via_supabase_rest("some-token")
        assert exc_info.value.status_code == 401

    def test_network_error_raises_503(self, monkeypatch):
        import httpx
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

        with patch("httpx.get", side_effect=httpx.RequestError("timeout")):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_via_supabase_rest("some-token")
        assert exc_info.value.status_code == 503

    def test_missing_supabase_url_raises_500(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
        with pytest.raises(HTTPException) as exc_info:
            _verify_jwt_via_supabase_rest("some-token")
        assert exc_info.value.status_code == 500


class TestVerifySupabaseJwt:
    def test_hs256_with_secret(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        token = _jwt(role="authenticated", sub="user-abc")
        payload = _verify_supabase_jwt(
            token,
            required_claims=("sub", "exp", "iat", "role"),
            allow_rest_fallback=True,
        )
        assert payload["sub"] == "user-abc"

    def test_hs256_without_secret_rest_fallback(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "user-fallback", "email": "fb@example.com"}

        token = _jwt()
        with patch("httpx.get", return_value=mock_resp):
            payload = _verify_supabase_jwt(
                token,
                required_claims=("sub", "exp", "iat", "role"),
                allow_rest_fallback=True,
            )
        assert payload["sub"] == "user-fallback"

    def test_hs256_without_secret_no_fallback_raises_500(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
        token = _jwt()
        with pytest.raises(HTTPException) as exc_info:
            _verify_supabase_jwt(
                token,
                required_claims=("sub",),
                allow_rest_fallback=False,
            )
        assert exc_info.value.status_code == 500

    def test_unsupported_algorithm_raises_401(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        # Create a token then patch header parsing to return unknown alg
        with patch("app.services.auth._jwt_algorithm", return_value="XYZ256"):
            with pytest.raises(HTTPException) as exc_info:
                _verify_supabase_jwt(
                    "fake.token.here",
                    required_claims=("sub",),
                    allow_rest_fallback=True,
                )
        assert exc_info.value.status_code == 401


# ── require_auth (FastAPI dependency) ─────────────────────────────────────────

class TestAuthenticatedUserRepr:
    def test_repr_includes_auth_id(self):
        from app.services.auth import AuthenticatedUser
        user = AuthenticatedUser(auth_id="some-uuid", email="test@test.com")
        assert "some-uuid" in repr(user)


class TestRequireAuth:
    def _make_request(self, headers: dict | None = None) -> Request:
        return _http_request(headers)

    def test_auth_disabled_returns_dev_bypass(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        monkeypatch.setenv("ENVIRONMENT", "development")
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            require_auth(self._make_request())
        )
        assert isinstance(result, AuthenticatedUser)

    def test_missing_token_raises_401(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        import asyncio
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(
                require_auth(self._make_request())
            )
        assert exc_info.value.status_code == 401

    def test_valid_token_returns_user(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)

        token = _jwt(role="authenticated", sub="user-xyz")
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            require_auth(self._make_request({"Authorization": f"Bearer {token}"}))
        )
        assert result.auth_id == "user-xyz"

    def test_missing_sub_claim_raises_401(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)

        # Token with no sub claim
        payload = {"role": "authenticated", "iat": int(time.time()), "exp": int(time.time()) + 3600}
        token = pyjwt.encode(payload, TEST_SECRET, algorithm="HS256")
        import asyncio
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(
                require_auth(self._make_request({"Authorization": f"Bearer {token}"}))
            )
        assert exc_info.value.status_code == 401

    def test_empty_sub_claim_raises_401(self, monkeypatch):
        """Cover line 434: `if not auth_id: raise HTTPException(401)`."""
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)

        # Empty string sub — passes PyJWT `require` check but fails `if not auth_id`
        payload = {"role": "authenticated", "sub": "", "iat": int(time.time()), "exp": int(time.time()) + 3600}
        token = pyjwt.encode(payload, TEST_SECRET, algorithm="HS256")
        import asyncio
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(
                require_auth(self._make_request({"Authorization": f"Bearer {token}"}))
            )
        assert exc_info.value.status_code == 401


class TestOptionalAuth:
    def test_returns_user_when_authenticated(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        monkeypatch.setenv("ENVIRONMENT", "development")
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            optional_auth(_http_request())
        )
        assert isinstance(result, AuthenticatedUser)

    def test_returns_none_on_401(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            optional_auth(_http_request())  # no Authorization header
        )
        assert result is None


class TestVerifyServiceRole:
    def test_auth_disabled_bypasses_check(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        monkeypatch.setenv("ENVIRONMENT", "development")
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            verify_service_role(_http_request())
        )
        assert result["role"] == "service_role"

    def test_missing_token_raises_401(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        import asyncio
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(
                verify_service_role(_http_request())
            )
        assert exc_info.value.status_code == 401

    def test_wrong_role_raises_403(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        token = _jwt(role="authenticated")
        import asyncio
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(
                verify_service_role(_http_request({"Authorization": f"Bearer {token}"}))
            )
        assert exc_info.value.status_code == 403

    def test_valid_service_role_token_returns_payload(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        token = _jwt(role="service_role")
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            verify_service_role(_http_request({"Authorization": f"Bearer {token}"}))
        )
        assert result["role"] == "service_role"


# ── _verify_jwt_with_supabase_jwks ────────────────────────────────────────────

class _PyJWKClientConnectionError(Exception):
    pass

_PyJWKClientConnectionError.__name__ = "PyJWKClientConnectionError"


class _InvalidAlgorithmError(Exception):
    pass

_InvalidAlgorithmError.__name__ = "InvalidAlgorithmError"


class TestVerifyJwtWithSupabaseJwks:
    def test_no_supabase_url_raises_500(self, monkeypatch):
        monkeypatch.delenv("SUPABASE_URL", raising=False)
        monkeypatch.delenv("BACKEND_SUPABASE_URL", raising=False)
        with pytest.raises(HTTPException) as exc_info:
            _verify_jwt_with_supabase_jwks("token", "RS256", required_claims=("sub",))
        assert exc_info.value.status_code == 500

    def test_success_returns_payload(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        mock_signing_key = MagicMock()
        mock_signing_key.key = "mock-key"
        mock_client_instance = MagicMock()
        mock_client_instance.get_signing_key_from_jwt.return_value = mock_signing_key

        with patch("app.services.auth._jwks_client", return_value=mock_client_instance):
            with patch("jwt.decode", return_value={"sub": "user-123", "role": "authenticated"}):
                result = _verify_jwt_with_supabase_jwks(
                    "fake.token", "RS256", required_claims=("sub",)
                )
        assert result["sub"] == "user-123"

    def test_jwks_connection_error_raises_503(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        mock_client_instance = MagicMock()
        mock_client_instance.get_signing_key_from_jwt.side_effect = _PyJWKClientConnectionError("no connection")

        with patch("app.services.auth._jwks_client", return_value=mock_client_instance):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_with_supabase_jwks("fake.token", "RS256", required_claims=("sub",))
        assert exc_info.value.status_code == 503

    def test_invalid_algorithm_error_raises_500(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        mock_client_instance = MagicMock()
        mock_client_instance.get_signing_key_from_jwt.side_effect = _InvalidAlgorithmError("no crypto")

        with patch("app.services.auth._jwks_client", return_value=mock_client_instance):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_with_supabase_jwks("fake.token", "RS256", required_claims=("sub",))
        assert exc_info.value.status_code == 500

    def test_other_exception_raises_401(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
        mock_client_instance = MagicMock()
        mock_client_instance.get_signing_key_from_jwt.side_effect = ValueError("bad token")

        with patch("app.services.auth._jwks_client", return_value=mock_client_instance):
            with pytest.raises(HTTPException) as exc_info:
                _verify_jwt_with_supabase_jwks("fake.token", "RS256", required_claims=("sub",))
        assert exc_info.value.status_code == 401


# ── require_websocket_auth ────────────────────────────────────────────────────

def _mock_websocket(auth_header: str | None = None, query_params: dict | None = None):
    ws = MagicMock()
    ws.headers = MagicMock()
    ws.headers.get = lambda key, default="": (
        auth_header if key == "Authorization" and auth_header is not None else default
    )
    ws.query_params = MagicMock()
    ws.query_params.get = lambda key: (query_params or {}).get(key)
    return ws


class TestRequireWebsocketAuth:
    def test_auth_disabled_returns_dev_bypass(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        monkeypatch.setenv("ENVIRONMENT", "development")
        import asyncio
        ws = _mock_websocket()
        result = asyncio.get_event_loop().run_until_complete(require_websocket_auth(ws))
        assert isinstance(result, AuthenticatedUser)

    def test_missing_token_raises_401(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        import asyncio
        ws = _mock_websocket()
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(require_websocket_auth(ws))
        assert exc_info.value.status_code == 401

    def test_valid_token_in_header_returns_user(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        token = _jwt(role="authenticated", sub="ws-user-id")
        import asyncio
        ws = _mock_websocket(auth_header=f"Bearer {token}")
        result = asyncio.get_event_loop().run_until_complete(require_websocket_auth(ws))
        assert result.auth_id == "ws-user-id"

    def test_valid_token_in_query_param_returns_user(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        token = _jwt(role="authenticated", sub="ws-query-user")
        import asyncio
        ws = _mock_websocket(query_params={"token": token})
        result = asyncio.get_event_loop().run_until_complete(require_websocket_auth(ws))
        assert result.auth_id == "ws-query-user"

    def test_token_missing_sub_raises_401(self, monkeypatch):
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        payload = {"role": "authenticated", "iat": int(time.time()), "exp": int(time.time()) + 3600}
        token = pyjwt.encode(payload, TEST_SECRET, algorithm="HS256")
        import asyncio
        ws = _mock_websocket(auth_header=f"Bearer {token}")
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(require_websocket_auth(ws))
        assert exc_info.value.status_code == 401

    def test_empty_sub_claim_raises_401(self, monkeypatch):
        """Cover line 479: `if not auth_id: raise HTTPException(401)` in websocket auth."""
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_SECRET)
        # Empty sub passes PyJWT `require` but fails `if not auth_id`
        payload = {"role": "authenticated", "sub": "", "iat": int(time.time()), "exp": int(time.time()) + 3600}
        token = pyjwt.encode(payload, TEST_SECRET, algorithm="HS256")
        import asyncio
        ws = _mock_websocket(auth_header=f"Bearer {token}")
        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(require_websocket_auth(ws))
        assert exc_info.value.status_code == 401
