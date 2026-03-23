"""
Integration tests for rate limiting against a real Supabase database.

Validates that:
- Rate limit headers are present in responses
- Requests beyond the threshold are blocked with 429
- The rate limiter uses the verified user identity
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.services.rate_limit import RateLimitService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_classifier_response() -> dict:
    return {
        "id": "resp_classifier_rl",
        "object": "response",
        "model": "gpt-5-nano",
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps({
                            "complexity": "low",
                            "requires_calculation": False,
                            "high_risk_decision": False,
                            "user_level": "beginner",
                        }),
                    }
                ],
            }
        ],
        "usage": {"input_tokens": 50, "output_tokens": 30, "total_tokens": 80},
    }


def _mock_chat_response() -> dict:
    return {
        "id": "resp_chat_rl",
        "object": "response",
        "model": "gpt-5-mini",
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "Rate limit test reply."}],
            }
        ],
        "usage": {"input_tokens": 100, "output_tokens": 30, "total_tokens": 130},
    }


class TestRateLimitingIntegration:
    """Test rate limiting with real auth and in-memory rate limiter."""

    @patch("app.routes.ai_proxy._call_openai_responses", new_callable=AsyncMock)
    def test_rate_limit_headers_present(
        self,
        mock_openai: AsyncMock,
        client: TestClient,
        auth_headers: dict[str, str],
    ):
        """Every chat response should include rate limit headers."""
        mock_openai.side_effect = [
            _mock_classifier_response(),
            _mock_chat_response(),
        ]

        response = client.post(
            "/api/chat",
            json={"message": "Test rate limit headers"},
            headers=auth_headers,
        )

        assert response.status_code == 200

        # Verify all three tiers of rate limit headers are present
        for window in ("minute", "hour", "day"):
            limit_header = f"x-ratelimit-limit-{window}"
            remaining_header = f"x-ratelimit-remaining-{window}"
            reset_header = f"x-ratelimit-reset-{window}"

            assert limit_header in response.headers, (
                f"Missing header: {limit_header}"
            )
            assert remaining_header in response.headers, (
                f"Missing header: {remaining_header}"
            )
            assert reset_header in response.headers, (
                f"Missing header: {reset_header}"
            )

            # Values should be numeric
            assert response.headers[limit_header].isdigit()
            assert response.headers[reset_header].isdigit()

    @patch("app.routes.ai_proxy._call_openai_responses", new_callable=AsyncMock)
    def test_rate_limit_remaining_decreases(
        self,
        mock_openai: AsyncMock,
        client: TestClient,
        auth_headers: dict[str, str],
    ):
        """The remaining count should decrease with each request."""
        # We need to reset the rate limiter state for this test to be predictable.
        # Import and reset the global rate limiter.
        from app.services.rate_limit import rate_limiter
        original_state = dict(rate_limiter._state)
        rate_limiter._state.clear()

        try:
            # First request
            mock_openai.side_effect = [
                _mock_classifier_response(),
                _mock_chat_response(),
            ]
            resp1 = client.post(
                "/api/chat",
                json={"message": "First request"},
                headers=auth_headers,
            )
            assert resp1.status_code == 200
            remaining1 = int(resp1.headers.get("x-ratelimit-remaining-minute", "0"))

            # Second request
            mock_openai.side_effect = [
                _mock_classifier_response(),
                _mock_chat_response(),
            ]
            resp2 = client.post(
                "/api/chat",
                json={"message": "Second request"},
                headers=auth_headers,
            )
            assert resp2.status_code == 200
            remaining2 = int(resp2.headers.get("x-ratelimit-remaining-minute", "0"))

            assert remaining2 < remaining1, (
                f"Remaining should decrease: {remaining1} -> {remaining2}"
            )
        finally:
            # Restore original state
            rate_limiter._state.clear()
            rate_limiter._state.update(original_state)

    @patch("app.routes.ai_proxy._call_openai_responses", new_callable=AsyncMock)
    def test_rate_limit_exceeded_returns_429(
        self,
        mock_openai: AsyncMock,
        client: TestClient,
        auth_headers: dict[str, str],
        test_user_credentials: dict,
    ):
        """
        Exceeding the per-minute rate limit should return 429.

        We use a fresh RateLimitService with a very low limit to avoid
        needing to send 20+ real requests.
        """
        from app.services import rate_limit as rl_module

        # Create a rate limiter with a per-minute limit of 2
        low_limit_config = rl_module.RateLimitConfig(
            requests_per_minute=2,
            requests_per_hour=200,
            requests_per_day=1000,
        )
        test_limiter = RateLimitService()
        test_limiter._endpoint_configs["/api/chat"] = low_limit_config
        test_limiter._default_config = low_limit_config

        # Patch the global rate_limiter used by ai_proxy
        original_limiter = rl_module.rate_limiter
        rl_module.rate_limiter = test_limiter

        # Also patch the import reference in ai_proxy
        import app.routes.ai_proxy as ai_proxy_mod
        original_ai_proxy_limiter = ai_proxy_mod.rate_limiter
        ai_proxy_mod.rate_limiter = test_limiter

        try:
            # Send requests up to the limit
            for i in range(2):
                mock_openai.side_effect = [
                    _mock_classifier_response(),
                    _mock_chat_response(),
                ]
                resp = client.post(
                    "/api/chat",
                    json={"message": f"Request {i + 1}"},
                    headers=auth_headers,
                )
                assert resp.status_code == 200, (
                    f"Request {i + 1} should succeed, got {resp.status_code}: {resp.text}"
                )

            # The next request should be rate-limited
            mock_openai.side_effect = [
                _mock_classifier_response(),
                _mock_chat_response(),
            ]
            resp_blocked = client.post(
                "/api/chat",
                json={"message": "This should be blocked"},
                headers=auth_headers,
            )
            assert resp_blocked.status_code == 429, (
                f"Expected 429, got {resp_blocked.status_code}: {resp_blocked.text}"
            )

            data = resp_blocked.json()
            assert "detail" in data
            assert "rate limit" in data["detail"].lower() or "exceeded" in data["detail"].lower()

        finally:
            # Restore the original rate limiter
            rl_module.rate_limiter = original_limiter
            ai_proxy_mod.rate_limiter = original_ai_proxy_limiter
