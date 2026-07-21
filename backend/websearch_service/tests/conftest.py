"""Pytest configuration and fixtures."""
import asyncio
import os
import time
from typing import AsyncGenerator
from unittest.mock import MagicMock, patch

# Shared test JWT secret — also set in mock_env_vars so auth.py picks it up.
TEST_JWT_SECRET = "test-jwt-secret-for-unit-tests"

# ─── Critical: seed required env vars BEFORE any app import ────────────────
# app.services.supabase_client (imported transitively by app.main) raises at
# module-import time when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent,
# so we must provide test placeholders before collection begins.
# setdefault keeps real values from .env.test intact for integration tests.
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
os.environ.setdefault("AUTH_REQUIRED", "false")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("TAVILY_API_KEY", "test-tavily-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("APP_VERSION", "test-version")

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

def run_async(coro):
    """Run a coroutine in a fresh event loop (Python 3.12+ safe)."""
    return asyncio.run(coro)

# Set stub Supabase credentials before the app module chain is imported.
# supabase_client.py calls create_client() at module level and raises if missing.
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

# Patch create_client so no real network connection is attempted at import time.
with patch("supabase.create_client", return_value=MagicMock()):
    from app.main import create_app

# ─── AI-provider network guard (Phase 3) ──────────────────────────────────
# Fail fast if any test tries to reach a real AI provider (openai/perplexity/
# anthropic). Blocks only AI-provider hostnames so integration tests against a
# test Supabase / local Redis are unaffected. Escape hatch for the sanctioned
# capped live validation: set ALLOW_REAL_AI_PROVIDER_NETWORK=1.
try:  # package import mode (tests/ has __init__.py)
    from tests.ai_network_guard import install_ai_network_guard
except ImportError:  # pragma: no cover - rootdir import-mode fallback
    from ai_network_guard import install_ai_network_guard
install_ai_network_guard()


def supabase_test_issuer() -> str:
    """Issuer claim expected by auth._verify_issuer for the test Supabase project."""
    base = os.environ.get("SUPABASE_URL", "https://test.supabase.co").rstrip("/")
    return f"{base}/auth/v1"


def _make_jwt(role: str = "service_role", sub: str = "test-service", **extra) -> str:
    """Create a signed HS256 JWT for testing."""
    now = int(time.time())
    payload = {
        "role": role,
        "sub": sub,
        "iat": now,
        "exp": extra.pop("exp", now + 3600),
        "iss": extra.pop("iss", supabase_test_issuer()),
        **extra,
    }
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
    with TestClient(app) as tc:
        yield tc


@pytest.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for the FastAPI app."""
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
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
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "test-anon-key")
    monkeypatch.delenv("VITE_SUPABASE_URL", raising=False)
    monkeypatch.delenv("VITE_SUPABASE_ANON_KEY", raising=False)
    monkeypatch.delenv("VITE_SUPABASE_SERVICE_ROLE_KEY", raising=False)


@pytest.fixture
def mock_audit_log_path(tmp_path, monkeypatch):
    """Set up a temporary audit log path."""
    log_path = tmp_path / "audit.jsonl"
    monkeypatch.setenv("AI_AUDIT_LOG_PATH", str(log_path))
    return log_path


@pytest.fixture(autouse=True)
def _clear_iris_local_cache():
    """The IRIS context layer keeps an in-process LRU keyed by user_id;
    clear it between tests so seeded supabase doubles aren't bypassed by a
    stale formatted block left over from a previous test."""
    from app.services import meridian_context
    meridian_context._local_cache.clear()
    yield
    meridian_context._local_cache.clear()
