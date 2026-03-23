"""
Integration tests for authentication against a real Supabase project.

Validates that the auth middleware correctly handles:
- Missing tokens (401)
- Invalid/malformed tokens (401)
- Valid test user tokens (success)
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


class TestAuthIntegration:
    """Test authentication enforcement with real Supabase JWTs."""

    def test_missing_auth_token_returns_401(self, client: TestClient):
        """A request with no Authorization header should be rejected."""
        response = client.post(
            "/api/chat",
            json={"message": "Hello"},
        )
        assert response.status_code == 401
        data = response.json()
        assert "detail" in data
        assert "token" in data["detail"].lower() or "auth" in data["detail"].lower()

    def test_invalid_token_returns_401(self, client: TestClient):
        """A request with a garbage token should be rejected."""
        response = client.post(
            "/api/chat",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer this-is-not-a-valid-jwt"},
        )
        assert response.status_code == 401

    def test_malformed_auth_header_returns_401(self, client: TestClient):
        """A request with a malformed Authorization header should be rejected."""
        response = client.post(
            "/api/chat",
            json={"message": "Hello"},
            headers={"Authorization": "NotBearer some-token"},
        )
        assert response.status_code == 401

    def test_expired_token_returns_401(self, client: TestClient):
        """A request with a structurally valid but expired JWT should be rejected."""
        # This is a syntactically valid JWT with an expired exp claim
        expired_jwt = (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
            "eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxMDAwMDAwMDAwLCJpYXQiOjEwMDAwMDAwMDAsInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYXVkIjoiYXV0aGVudGljYXRlZCJ9."
            "invalid-signature"
        )
        response = client.post(
            "/api/chat",
            json={"message": "Hello"},
            headers={"Authorization": f"Bearer {expired_jwt}"},
        )
        assert response.status_code == 401

    def test_valid_token_passes_auth(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ):
        """
        A request with a valid test user JWT should pass authentication.

        We hit /health (no auth required) and /api/chat (auth required).
        The /api/chat call may fail downstream (e.g. OpenAI not configured),
        but should NOT fail with 401 — proving auth passed.
        """
        # Health check should always work (no auth required)
        health_resp = client.get("/health")
        assert health_resp.status_code == 200

        # Chat endpoint with valid auth — expect something other than 401
        # It might return 500 (OpenAI not configured) or 200, but NOT 401
        response = client.post(
            "/api/chat",
            json={"message": "What is a stock?"},
            headers=auth_headers,
        )
        assert response.status_code != 401, (
            f"Valid token was rejected with 401: {response.json()}"
        )

    def test_empty_bearer_token_returns_401(self, client: TestClient):
        """A request with an empty Bearer value should be rejected."""
        response = client.post(
            "/api/chat",
            json={"message": "Hello"},
            headers={"Authorization": "Bearer "},
        )
        assert response.status_code == 401
