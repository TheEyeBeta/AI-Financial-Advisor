"""Tests for main FastAPI application."""
import pytest
from fastapi.testclient import TestClient


def test_health_check(client: TestClient):
    """Test the health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "timestamp" in data
    assert "uptime_seconds" in data
    assert data["version"] == "test-version"
    assert data["environment"] == "test"


def test_liveness_check(client: TestClient):
    """Test the liveness check endpoint."""
    response = client.get("/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "alive"


@pytest.mark.asyncio
async def test_readiness_check_without_api_key(client: TestClient, monkeypatch):
    """Test readiness check when API key is missing."""
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    response = client.get("/health/ready")
    assert response.status_code == 503
    data = response.json()
    assert data["detail"]["status"] == "not_ready"
    assert "dependencies" in data["detail"]


def test_app_creation():
    """Test that the app can be created."""
    from app.main import create_app
    
    app = create_app()
    assert app is not None
    assert app.title == "AI Financial Advisor - Web Search Service"
