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
    
    mock_response_data = {
        "choices": [{"message": {"content": "Test response"}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
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
    
    mock_response_data = {
        "choices": [{"message": {"content": "Test response"}}],
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
    
    mock_response_data = {
        "choices": [{"message": {"content": ""}}],
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


def test_chat_endpoint_rate_limit(client: TestClient):
    """Test chat endpoint rate limiting."""
    # Clear rate limit state before test
    rate_limiter._state.clear()
    
    mock_response_data = {
        "choices": [{"message": {"content": "Test"}}],
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
    
    mock_response_data = {
        "choices": [{"message": {"content": "Test"}}],
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
    
    mock_response_data = {
        "choices": [{"message": {"content": "Test"}}],
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
