"""
Fixtures for backend integration tests against a real Supabase test database.

These tests require valid Supabase credentials in .env.test (or via env vars).
They are skipped automatically when placeholder values are detected.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import AsyncGenerator, Generator

import pytest
import httpx
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from httpx import AsyncClient

# ---------------------------------------------------------------------------
# Load .env.test from the websearch_service directory
# ---------------------------------------------------------------------------
_env_test_path = Path(__file__).resolve().parent.parent.parent / ".env.test"
if _env_test_path.exists():
    load_dotenv(_env_test_path, override=True)

# ---------------------------------------------------------------------------
# Detect placeholder credentials — skip the whole suite if not configured
# ---------------------------------------------------------------------------
_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
_SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

_HAS_REAL_DB = (
    _SUPABASE_URL
    and "your-test-project" not in _SUPABASE_URL
    and _SUPABASE_ANON_KEY
    and "your-test-anon-key" not in _SUPABASE_ANON_KEY
    and _SUPABASE_SERVICE_ROLE_KEY
    and "your-test-service-role-key" not in _SUPABASE_SERVICE_ROLE_KEY
)

skip_if_no_test_db = pytest.mark.skipif(
    not _HAS_REAL_DB,
    reason="Supabase test credentials not configured (placeholder values in .env.test)",
)

# Apply the marker to every test in this package automatically
pytestmark = skip_if_no_test_db


# ---------------------------------------------------------------------------
# Unique prefix for test-created data, to avoid collisions
# ---------------------------------------------------------------------------
TEST_EMAIL_PREFIX = "integration-test"


def _test_email() -> str:
    """Generate a unique email for the test user."""
    return f"{TEST_EMAIL_PREFIX}-{uuid.uuid4().hex[:8]}@test.theeyeplatform.com"


# ---------------------------------------------------------------------------
# Supabase admin helpers (via REST — no SDK needed for auth admin)
# ---------------------------------------------------------------------------

def _admin_headers() -> dict[str, str]:
    return {
        "apikey": _SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {_SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def _create_test_user(email: str, password: str) -> dict:
    """Create a test user via the Supabase Auth Admin API. Returns user data."""
    resp = httpx.post(
        f"{_SUPABASE_URL.rstrip('/')}/auth/v1/admin/users",
        headers=_admin_headers(),
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()


def _delete_test_user(user_id: str) -> None:
    """Delete a test user via the Supabase Auth Admin API."""
    try:
        resp = httpx.delete(
            f"{_SUPABASE_URL.rstrip('/')}/auth/v1/admin/users/{user_id}",
            headers=_admin_headers(),
            timeout=15.0,
        )
        resp.raise_for_status()
    except Exception:
        pass  # Best-effort cleanup


def _sign_in_test_user(email: str, password: str) -> dict:
    """Sign in the test user to obtain a real JWT access_token."""
    resp = httpx.post(
        f"{_SUPABASE_URL.rstrip('/')}/auth/v1/token?grant_type=password",
        headers={
            "apikey": _SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()


def _cleanup_test_data(user_id: str) -> None:
    """Delete test data created in Supabase tables by user_id."""
    headers = _admin_headers()
    base = _SUPABASE_URL.rstrip("/")

    # Tables that may hold test data — order matters (foreign keys)
    cleanup_targets = [
        ("ai", "iris_context_cache"),
        ("meridian", "user_goals"),
        ("meridian", "risk_alerts"),
        ("meridian", "meridian_events"),
        ("core", "user_profiles"),
        ("core", "rate_limit_state"),
    ]

    for schema, table in cleanup_targets:
        try:
            # Use PostgREST schema header to target the correct schema
            hdrs = {**headers, "Accept-Profile": schema, "Content-Profile": schema}
            httpx.delete(
                f"{base}/rest/v1/{table}?user_id=eq.{user_id}",
                headers=hdrs,
                timeout=10.0,
            )
        except Exception:
            pass  # Best-effort cleanup

    # Clean rate limit state by identifier pattern
    try:
        hdrs = {**headers, "Accept-Profile": "core", "Content-Profile": "core"}
        httpx.delete(
            f"{base}/rest/v1/rate_limit_state?identifier=eq.user:{user_id}",
            headers=hdrs,
            timeout=10.0,
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def test_user_credentials() -> Generator[dict, None, None]:
    """
    Session-scoped fixture: creates a test user, yields credentials, then deletes.

    Yields a dict with keys: user_id, email, password, access_token
    """
    email = _test_email()
    password = f"TestP@ss{uuid.uuid4().hex[:8]}!"

    user_data = _create_test_user(email, password)
    user_id = user_data.get("id") or user_data.get("user", {}).get("id")
    assert user_id, f"Failed to create test user, response: {user_data}"

    # Sign in to get a JWT
    token_data = _sign_in_test_user(email, password)
    access_token = token_data["access_token"]

    creds = {
        "user_id": user_id,
        "email": email,
        "password": password,
        "access_token": access_token,
    }

    yield creds

    # Teardown: clean test data, then delete the user
    _cleanup_test_data(user_id)
    _delete_test_user(user_id)


@pytest.fixture(scope="session")
def auth_headers(test_user_credentials: dict) -> dict[str, str]:
    """Return Authorization headers for the test user."""
    return {"Authorization": f"Bearer {test_user_credentials['access_token']}"}


@pytest.fixture(autouse=True)
def override_env_for_integration(monkeypatch):
    """
    Override the parent conftest's mock_env_vars fixture.

    The parent tests/conftest.py sets AUTH_REQUIRED=false for unit tests.
    Integration tests need real auth enabled.
    """
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("ENVIRONMENT", "test")
    # Keep the SUPABASE_URL / keys from .env.test (already loaded at module level)


@pytest.fixture(scope="session")
def app():
    """Create the FastAPI app once per session."""
    # Ensure environment is set for test mode
    os.environ.setdefault("ENVIRONMENT", "test")
    os.environ.setdefault("AUTH_REQUIRED", "true")

    from app.main import create_app
    return create_app()


@pytest.fixture
def client(app) -> TestClient:
    """Synchronous test client."""
    return TestClient(app)


@pytest.fixture
async def async_client(app) -> AsyncGenerator[AsyncClient, None]:
    """Async test client."""
    async with AsyncClient(app=app, base_url="http://testserver") as ac:
        yield ac
