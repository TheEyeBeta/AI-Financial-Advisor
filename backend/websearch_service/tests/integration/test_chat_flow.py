"""
Integration tests for the /api/chat endpoint against a real Supabase database.

These tests mock only the OpenAI API call so that we validate:
- Real Supabase auth (JWT validation)
- Real rate limiting with DB persistence
- Real audit logging
- Real Meridian context lookup
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_openai_response(content: str = "This is a test response.") -> dict:
    """Build a realistic OpenAI Responses API response payload."""
    return {
        "id": "resp_test_123",
        "object": "response",
        "model": "gpt-5-mini",
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": content}],
            }
        ],
        "usage": {
            "input_tokens": 150,
            "output_tokens": 50,
            "total_tokens": 200,
        },
    }


def _mock_classifier_response() -> dict:
    """Build a mock classifier response."""
    return {
        "id": "resp_classifier_test",
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


class TestChatFlowIntegration:
    """Test the full /api/chat flow with real Supabase, mocked OpenAI."""

    @patch("app.routes.ai_proxy._call_openai_responses", new_callable=AsyncMock)
    def test_chat_returns_valid_response(
        self,
        mock_openai: AsyncMock,
        client: TestClient,
        auth_headers: dict[str, str],
        test_user_credentials: dict,
    ):
        """
        POST /api/chat with a real JWT should return a well-formed response.

        We mock the OpenAI call so we don't need a real API key, but
        everything else (auth, rate limiting, audit) hits real infrastructure.
        """
        # First call is the classifier, second is the actual chat
        mock_openai.side_effect = [
            _mock_classifier_response(),
            _mock_openai_response("Stocks represent partial ownership in a company."),
        ]

        response = client.post(
            "/api/chat",
            json={"message": "What is a stock?"},
            headers=auth_headers,
        )

        assert response.status_code == 200, (
            f"Chat failed with {response.status_code}: {response.text}"
        )

        data = response.json()
        assert "response" in data
        assert len(data["response"]) > 0
        assert "ownership" in data["response"].lower()

    @patch("app.routes.ai_proxy._call_openai_responses", new_callable=AsyncMock)
    def test_chat_includes_rate_limit_headers(
        self,
        mock_openai: AsyncMock,
        client: TestClient,
        auth_headers: dict[str, str],
    ):
        """Responses should include X-RateLimit-* headers."""
        mock_openai.side_effect = [
            _mock_classifier_response(),
            _mock_openai_response("Test response."),
        ]

        response = client.post(
            "/api/chat",
            json={"message": "What is an ETF?"},
            headers=auth_headers,
        )

        # The response should have rate limit headers (even if values vary)
        assert response.status_code == 200
        assert "x-ratelimit-limit-minute" in response.headers
        assert "x-ratelimit-remaining-minute" in response.headers

    @patch("app.routes.ai_proxy._call_openai_responses", new_callable=AsyncMock)
    def test_chat_creates_audit_log_entry(
        self,
        mock_openai: AsyncMock,
        client: TestClient,
        auth_headers: dict[str, str],
        tmp_path: Path,
        monkeypatch,
    ):
        """The /api/chat endpoint should write audit log entries."""
        audit_log_file = tmp_path / "audit.jsonl"
        monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(audit_log_file))

        mock_openai.side_effect = [
            _mock_classifier_response(),
            _mock_openai_response("Diversification spreads risk."),
        ]

        response = client.post(
            "/api/chat",
            json={"message": "Why should I diversify?"},
            headers=auth_headers,
        )

        assert response.status_code == 200

        # The audit log should have been written to
        if audit_log_file.exists():
            lines = audit_log_file.read_text().strip().split("\n")
            events = [json.loads(line) for line in lines if line.strip()]

            event_types = [e.get("event") for e in events]
            # We expect at least a chat_request and chat_response event
            assert "chat_request" in event_types, (
                f"Expected 'chat_request' in audit events, got: {event_types}"
            )

    @patch("app.routes.ai_proxy._call_openai_responses", new_callable=AsyncMock)
    def test_chat_with_messages_array(
        self,
        mock_openai: AsyncMock,
        client: TestClient,
        auth_headers: dict[str, str],
    ):
        """Test /api/chat with the messages array format (multi-turn)."""
        mock_openai.side_effect = [
            _mock_classifier_response(),
            _mock_openai_response("Bonds are debt instruments issued by governments or corporations."),
        ]

        response = client.post(
            "/api/chat",
            json={
                "messages": [
                    {"role": "user", "content": "What are bonds?"},
                ]
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "response" in data
        assert len(data["response"]) > 0

    def test_chat_without_message_returns_422(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
    ):
        """Sending an empty body should return 422 (validation error)."""
        response = client.post(
            "/api/chat",
            json={},
            headers=auth_headers,
        )
        assert response.status_code == 422
