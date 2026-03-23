"""Pytest configuration and fixtures."""
import os
import time
from typing import AsyncGenerator

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient

from app.main import create_app

# Shared test JWT secret — also set in mock_env_vars so auth.py picks it up.
TEST_JWT_SECRET = "test-jwt-secret-for-unit-tests"


def _make_jwt(role: str = "service_role", sub: str = "test-service", **extra) -> str:
    """Create a signed HS256 JWT for testing."""
    payload = {"role": role, "sub": sub, "iat": int(time.time()), **extra}
    return pyjwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


@pytest.fixture
def service_role_jwt() -> str:
    """A valid service-role JWT for admin endpoint tests."""
    return _make_jwt(role="service_role")


@pytest.fixture
def anon_role_jwt() -> str:
    """A JWT with role=anon (should be rejected by service-role endpoints)."""
    return _make_jwt(role="anon")


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
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)


@pytest.fixture
def mock_audit_log_path(tmp_path, monkeypatch):
    """Set up a temporary audit log path."""
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))
    return log_path
