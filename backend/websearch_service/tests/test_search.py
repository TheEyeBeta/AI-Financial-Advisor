"""Tests for search route."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
import httpx


@pytest.mark.asyncio
async def test_search_endpoint_success(client: TestClient):
    """Test successful web search."""
    mock_response_data = {
        "results": [
            {
                "title": "Test Result",
                "url": "https://example.com",
                "content": "Test content snippet",
            }
        ]
    }
    
    # Mock the AsyncClient context manager
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.get("/api/search?query=test%20query&max_results=5")
        
        assert response.status_code == 200
        data = response.json()
        assert data["query"] == "test query"
        assert len(data["results"]) == 1
        assert data["results"][0]["title"] == "Test Result"
        assert data["results"][0]["url"] == "https://example.com"
        assert data["results"][0]["snippet"] == "Test content snippet"


def test_search_endpoint_missing_api_key(client: TestClient, monkeypatch):
    """Test search endpoint when API key is missing."""
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    
    response = client.get("/api/search?query=test")
    assert response.status_code == 500
    assert "not available" in response.json()["detail"]


def test_search_endpoint_query_too_short(client: TestClient):
    """Test search endpoint with query that's too short."""
    response = client.get("/api/search?query=ab")
    assert response.status_code == 422


def test_search_endpoint_max_results_validation(client: TestClient):
    """Test search endpoint max_results validation."""
    # Test max_results too high
    response = client.get("/api/search?query=test&max_results=20")
    assert response.status_code == 422
    
    # Test max_results too low
    response = client.get("/api/search?query=test&max_results=0")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_search_endpoint_provider_error(client: TestClient):
    """Test search endpoint when provider returns error."""
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.get("/api/search?query=test")
        assert response.status_code == 502


@pytest.mark.asyncio
async def test_search_endpoint_network_error(client: TestClient):
    """Test search endpoint when network error occurs."""
    import httpx

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.RequestError("Connection failed"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.get("/api/search?query=test")
        assert response.status_code == 502
        assert "unavailable" in response.json()["detail"]


@pytest.mark.asyncio
async def test_search_endpoint_empty_results(client: TestClient):
    """Test search endpoint with empty results."""
    mock_response_data = {"results": []}
    
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.get("/api/search?query=test")
        assert response.status_code == 200
        data = response.json()
        assert data["results"] == []


@pytest.mark.asyncio
async def test_check_search_provider_connected(client: TestClient):
    """Test check_search_provider when connected."""
    mock_response_data = {"results": []}
    
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_response_data
    mock_response.text = ""
    mock_client.post = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        response = client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"
        assert data["dependencies"]["search_api"]["status"] == "connected"


@pytest.mark.asyncio
async def test_check_search_provider_down(client: TestClient, monkeypatch):
    """Test check_search_provider when provider is down."""
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    
    response = client.get("/health/ready")
    assert response.status_code == 503
