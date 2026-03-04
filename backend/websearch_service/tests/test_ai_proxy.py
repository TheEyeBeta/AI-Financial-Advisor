"""Tests for AI proxy route."""
import pytest
import time
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
import httpx
from app.services.rate_limit import rate_limiter


@pytest.mark.asyncio
async def test_chat_endpoint_success(client: TestClient):
    """Test successful chat completion."""
    # Clear rate limit state
    rate_limiter._state.clear()

    # Responses API format: classifier + main chat both return this mock.
    # Classifier will parse it, find no "complexity" key, and default to "medium".
    # Main chat will extract final_answer = "Test response".
    fa_text = (
        '{"needs_clarification": false, "clarification_questions": [], '
        '"assumptions": [], "analysis_summary": "Test analysis", '
        '"final_answer": "Test response", "confidence": 0.9}'
    )
    mock_response_data = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": fa_text}]}],
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    }

    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post(
            "/api/chat",
            json={"message": "Hello", "user_id": "test-user"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["response"] == "Test response"


@pytest.mark.asyncio
async def test_chat_endpoint_success_with_top_level_output_text(client: TestClient):
    """Test chat completion when Responses API returns top-level output_text."""
    rate_limiter._state.clear()

    fa_text = (
        '{"needs_clarification": false, "clarification_questions": [], '
        '"assumptions": [], "analysis_summary": "", '
        '"final_answer": "Top-level text response", "confidence": 0.9}'
    )
    mock_response_data = {
        "output_text": fa_text,
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    }

    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post("/api/chat", json={"message": "Hello", "user_id": "test-user"})
        assert response.status_code == 200
        assert response.json()["response"] == "Top-level text response"


@pytest.mark.asyncio
async def test_chat_endpoint_appends_test_disclaimer_for_actionable_advice(client: TestClient):
    """Actionable recommendations should include the test-mode disclaimer."""
    rate_limiter._state.clear()

    fa_text = (
        '{"needs_clarification": false, "clarification_questions": [], '
        '"assumptions": [], "analysis_summary": "", '
        '"final_answer": "I would buy AAPL and set a stop loss at 5%.", "confidence": 0.85}'
    )
    mock_response_data = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": fa_text}]}],
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    }

    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post("/api/chat", json={"message": "Should I buy AAPL?"})

        assert response.status_code == 200
        data = response.json()
        assert "Test mode only. Not financial advice." in data["response"]


def test_chat_endpoint_missing_api_key(client: TestClient, monkeypatch):
    """Test chat endpoint when API key is missing."""
    # Clear rate limit state
    rate_limiter._state.clear()
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    
    response = client.post("/api/chat", json={"message": "Hello"})
    assert response.status_code == 500
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_chat_endpoint_missing_message(client: TestClient):
    """Test chat endpoint when message is missing."""
    response = client.post("/api/chat", json={})
    assert response.status_code == 422


def test_chat_endpoint_with_messages(client: TestClient):
    """Test chat endpoint with messages array."""
    # Clear rate limit state
    rate_limiter._state.clear()

    fa_text = (
        '{"needs_clarification": false, "clarification_questions": [], '
        '"assumptions": [], "analysis_summary": "", '
        '"final_answer": "Test response", "confidence": 0.8}'
    )
    mock_response_data = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": fa_text}]}],
        "usage": {},
    }

    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post(
            "/api/chat",
            json={
                "messages": [
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi there"},
                ]
            },
        )

        assert response.status_code == 200


def test_chat_endpoint_message_too_long(client: TestClient):
    """Test chat endpoint with message that's too long."""
    long_message = "a" * 10001
    response = client.post("/api/chat", json={"message": long_message})
    assert response.status_code == 422


def test_chat_endpoint_empty_response(client: TestClient):
    """Test chat endpoint when provider returns empty response."""
    # Clear rate limit state
    rate_limiter._state.clear()

    # Both classifier and main chat receive empty text.
    # Classifier falls back to default classification; main chat raises 502.
    mock_response_data = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": ""}]}],
        "usage": {},
    }

    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post("/api/chat", json={"message": "Hello"})
        assert response.status_code == 502


@pytest.mark.asyncio
async def test_chat_endpoint_retries_after_reasoning_token_exhaustion(client: TestClient):
    """Retry once when output budget is fully consumed by reasoning tokens."""
    rate_limiter._state.clear()

    classifier_json = '{"complexity":"high","requires_calculation":true,"high_risk_decision":false}'
    exhausted_response_data = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": ""}]}],
        "usage": {
            "input_tokens": 120,
            "output_tokens": 640,
            "output_tokens_details": {"reasoning_tokens": 640},
        },
    }
    final_json = (
        '{"needs_clarification": false, "clarification_questions": [], '
        '"assumptions": [], "analysis_summary": "", '
        '"final_answer": "Recovered answer after retry.", "confidence": 0.9}'
    )

    classifier_response = MagicMock()
    classifier_response.status_code = 200
    classifier_response.json.return_value = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": classifier_json}]}],
        "usage": {"input_tokens": 8, "output_tokens": 5, "total_tokens": 13},
    }
    classifier_response.text = ""

    exhausted_response = MagicMock()
    exhausted_response.status_code = 200
    exhausted_response.json.return_value = exhausted_response_data
    exhausted_response.text = ""

    retry_response = MagicMock()
    retry_response.status_code = 200
    retry_response.json.return_value = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": final_json}]}],
        "usage": {"input_tokens": 150, "output_tokens": 60, "total_tokens": 210},
    }
    retry_response.text = ""

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=[classifier_response, exhausted_response, retry_response])
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post("/api/chat", json={"message": "Hello", "max_tokens": 700})
        assert response.status_code == 200
        assert response.json()["response"] == "Recovered answer after retry."

        call_args = mock_client.post.await_args_list
        first_chat_payload = call_args[1].kwargs["json"]
        retry_chat_payload = call_args[2].kwargs["json"]
        assert first_chat_payload["max_output_tokens"] == 8000
        assert retry_chat_payload["reasoning"]["effort"] == "low"
        assert retry_chat_payload["max_output_tokens"] == 8000


def test_chat_endpoint_rate_limit(client: TestClient):
    """Test chat endpoint rate limiting."""
    # Clear rate limit state before test
    rate_limiter._state.clear()

    fa_text = (
        '{"needs_clarification": false, "clarification_questions": [], '
        '"assumptions": [], "analysis_summary": "", "final_answer": "Test", "confidence": 0.9}'
    )
    mock_response_data = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": fa_text}]}],
        "usage": {},
    }

    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        test_ip = "192.168.1.100"
        identifier = f"ip:{test_ip}"
        
        # Make requests up to the minute limit (20 for /api/chat)
        limit = 20  # requests_per_minute for /api/chat endpoint
        
        for i in range(limit):
            response = client.post(
                "/api/chat",
                json={"message": f"Request {i}"},
                headers={"X-Forwarded-For": test_ip},
            )
            if response.status_code != 200:
                # If we hit rate limit early, that's also a valid test
                break
            assert response.status_code == 200
        
        # Next request should be rate limited
        response = client.post(
            "/api/chat",
            json={"message": "Request over limit"},
            headers={"X-Forwarded-For": test_ip},
        )
        assert response.status_code == 429
        assert "Rate limit exceeded" in response.json()["detail"]


@pytest.mark.asyncio
async def test_chat_title_endpoint(client: TestClient):
    """Test chat title generation endpoint."""
    # Clear rate limit state
    rate_limiter._state.clear()
    
    mock_response_data = {
        "choices": [{"message": {"content": "Financial Planning Discussion"}}],
        "usage": {},
    }
    
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post(
            "/api/chat/title",
            json={"first_message": "What is financial planning?"},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "title" in data
        assert data["title"] == "Financial Planning Discussion"


@pytest.mark.asyncio
async def test_chat_title_endpoint_with_content_array(client: TestClient):
    """Title generation should support content arrays returned by providers."""
    rate_limiter._state.clear()

    mock_response_data = {
        "choices": [{"message": {"content": [{"type": "output_text", "text": "Portfolio Risk Review"}]}}],
        "usage": {},
    }

    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post(
            "/api/chat/title",
            json={"first_message": "Can you review my portfolio risk?"},
        )
        assert response.status_code == 200
        assert response.json()["title"] == "Portfolio Risk Review"


def test_chat_title_endpoint_empty_message(client: TestClient):
    """Test chat title endpoint with empty message."""
    response = client.post("/api/chat/title", json={"first_message": ""})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_analyze_quantitative_endpoint(client: TestClient):
    """Test quantitative analysis endpoint."""
    # Clear rate limit state
    rate_limiter._state.clear()
    
    mock_response_data = {
        "choices": [{"message": {"content": "Analysis: Strong performance"}}],
        "usage": {},
    }
    
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post(
            "/api/ai/analyze-quantitative",
            json={"quantitative_data": {"win_rate": 0.75, "profit_factor": 2.5}},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "response" in data


def test_analyze_quantitative_endpoint_invalid_data(client: TestClient):
    """Test quantitative analysis endpoint with invalid data."""
    response = client.post(
        "/api/ai/analyze-quantitative",
        json={"quantitative_data": "invalid"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_chat_endpoint_temperature_validation(client: TestClient):
    """Test chat endpoint temperature parameter validation."""
    # Clear rate limit state
    rate_limiter._state.clear()

    fa_text = (
        '{"needs_clarification": false, "clarification_questions": [], '
        '"assumptions": [], "analysis_summary": "", "final_answer": "Test", "confidence": 0.9}'
    )
    mock_response_data = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": fa_text}]}],
        "usage": {},
    }
    
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        # Test temperature too high
        response = client.post(
            "/api/chat",
            json={"message": "Hello", "temperature": 3.0},
        )
        assert response.status_code == 422
        
        # Test temperature too low
        response = client.post(
            "/api/chat",
            json={"message": "Hello", "temperature": -1.0},
        )
        assert response.status_code == 422
        
        # Clear rate limit before valid test
        rate_limiter._state.clear()
        # Test valid temperature
        response = client.post(
            "/api/chat",
            json={"message": "Hello", "temperature": 0.7},
        )
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_chat_endpoint_max_tokens_validation(client: TestClient):
    """Test chat endpoint max_tokens parameter validation."""
    # Clear rate limit state
    rate_limiter._state.clear()

    fa_text = (
        '{"needs_clarification": false, "clarification_questions": [], '
        '"assumptions": [], "analysis_summary": "", "final_answer": "Test", "confidence": 0.9}'
    )
    mock_response_data = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": fa_text}]}],
        "usage": {},
    }
    
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        # Test max_tokens too high
        response = client.post(
            "/api/chat",
            json={"message": "Hello", "max_tokens": 3000},
        )
        assert response.status_code == 422
        
        # Test max_tokens too low
        response = client.post(
            "/api/chat",
            json={"message": "Hello", "max_tokens": 0},
        )
        assert response.status_code == 422
        
        # Clear rate limit before valid test
        rate_limiter._state.clear()
        # Test valid max_tokens
        response = client.post(
            "/api/chat",
            json={"message": "Hello", "max_tokens": 500},
        )
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_chat_endpoint_network_error(client: TestClient):
    """Test chat endpoint when network error occurs."""
    import httpx
    
    # Clear rate limit state
    rate_limiter._state.clear()
    
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.RequestError("Connection failed"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.post("/api/chat", json={"message": "Hello"})
        assert response.status_code == 502
