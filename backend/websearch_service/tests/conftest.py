"""Pytest configuration and fixtures."""
import os
from typing import AsyncGenerator

import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient

from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    """Create a test client for the FastAPI app."""
    app = create_app()
    return TestClient(app)


@pytest.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for the FastAPI app."""
    app = create_app()
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def mock_env_vars(monkeypatch):
    """Mock environment variables for testing."""
    monkeypatch.setenv("TAVILY_API_KEY", "test-tavily-key")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("APP_VERSION", "test-version")
    monkeypatch.setenv("ENVIRONMENT", "test")


@pytest.fixture
def mock_audit_log_path(tmp_path, monkeypatch):
    """Set up a temporary audit log path."""
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))
    return log_path
