"""
Integration tests for Meridian context refresh against a real Supabase database.

Validates that:
- The context cache refresh reads from core/meridian schemas and writes to ai.iris_context_cache
- Data written can be retrieved via build_iris_context
- Cleanup removes test data
"""
from __future__ import annotations

import os

import httpx
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _supabase_rest_headers(schema: str = "core") -> dict[str, str]:
    """Build headers for direct Supabase REST calls."""
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
        "Accept-Profile": schema,
        "Content-Profile": schema,
    }


def _supabase_url() -> str:
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def _insert_test_profile(user_id: str) -> dict:
    """Insert a test user profile into core.user_profiles via REST."""
    resp = httpx.post(
        f"{_supabase_url()}/rest/v1/user_profiles",
        headers=_supabase_rest_headers("core"),
        json={
            "user_id": user_id,
            "risk_profile": "moderate",
            "investment_horizon": "5-10 years",
            "monthly_investable": 500.0,
            "emergency_fund_months": 4.0,
            "knowledge_tier": 2,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()


def _insert_test_goal(user_id: str) -> dict:
    """Insert a test goal into meridian.user_goals via REST."""
    resp = httpx.post(
        f"{_supabase_url()}/rest/v1/user_goals",
        headers=_supabase_rest_headers("meridian"),
        json={
            "user_id": user_id,
            "goal_name": "Integration Test Goal",
            "target_amount": 10000.0,
            "current_amount": 2500.0,
            "status": "active",
            "monthly_contribution": 200.0,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()


def _get_iris_cache(user_id: str) -> list:
    """Fetch the iris_context_cache entry for a user."""
    resp = httpx.get(
        f"{_supabase_url()}/rest/v1/iris_context_cache?user_id=eq.{user_id}",
        headers=_supabase_rest_headers("ai"),
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()


def _delete_test_profile(user_id: str) -> None:
    for schema, table in [
        ("ai", "iris_context_cache"),
        ("meridian", "user_goals"),
        ("meridian", "risk_alerts"),
        ("meridian", "meridian_events"),
        ("core", "user_profiles"),
    ]:
        try:
            httpx.delete(
                f"{_supabase_url()}/rest/v1/{table}?user_id=eq.{user_id}",
                headers=_supabase_rest_headers(schema),
                timeout=10.0,
            )
        except Exception:
            pass


class TestMeridianContextIntegration:
    """Test Meridian context refresh with real Supabase data."""

    @pytest.fixture(autouse=True)
    def setup_test_data(self, test_user_credentials: dict):
        """Insert seed data before each test and clean up after."""
        self.user_id = test_user_credentials["user_id"]
        # Insert test profile and goal
        try:
            _insert_test_profile(self.user_id)
        except httpx.HTTPStatusError:
            # Profile may already exist from a previous run; update it
            pass
        try:
            _insert_test_goal(self.user_id)
        except httpx.HTTPStatusError:
            pass

        yield

        # Cleanup — delete the iris cache entry and seed data
        _delete_test_profile(self.user_id)

    @pytest.mark.asyncio
    async def test_refresh_writes_to_iris_cache(self):
        """
        Calling refresh_iris_context_cache should read from core/meridian
        and write a cache entry to ai.iris_context_cache.
        """
        from app.services.meridian_context import refresh_iris_context_cache

        await refresh_iris_context_cache(self.user_id)

        # Verify the cache entry was written
        cache_rows = _get_iris_cache(self.user_id)
        assert len(cache_rows) >= 1, (
            f"Expected at least 1 iris_context_cache row for user {self.user_id}"
        )

        cache = cache_rows[0]
        assert cache["user_id"] == self.user_id
        assert cache.get("profile_summary") is not None
        assert cache.get("knowledge_tier") == 2

        # Profile summary should reflect seed data
        profile = cache["profile_summary"]
        assert profile.get("risk_profile") == "moderate"

    @pytest.mark.asyncio
    async def test_build_iris_context_returns_formatted_string(self):
        """
        After a cache refresh, build_iris_context should return a non-empty
        formatted context block.
        """
        from app.services.meridian_context import (
            build_iris_context,
            refresh_iris_context_cache,
        )

        await refresh_iris_context_cache(self.user_id)
        context = await build_iris_context(self.user_id)

        assert isinstance(context, str)
        assert len(context) > 0
        assert "MERIDIAN" in context
        assert "moderate" in context.lower()

    @pytest.mark.asyncio
    async def test_build_iris_context_returns_empty_for_unknown_user(self):
        """
        build_iris_context should gracefully return empty string for
        a user_id with no cache entry.
        """
        from app.services.meridian_context import build_iris_context

        context = await build_iris_context("00000000-0000-0000-0000-000000000000")
        assert context == ""

    @pytest.mark.asyncio
    async def test_refresh_includes_goal_data(self):
        """The cached context should include active goals from meridian.user_goals."""
        from app.services.meridian_context import refresh_iris_context_cache

        await refresh_iris_context_cache(self.user_id)

        cache_rows = _get_iris_cache(self.user_id)
        assert len(cache_rows) >= 1

        goals = cache_rows[0].get("active_goals", [])
        assert len(goals) >= 1, "Expected at least one goal in the cache"

        goal = goals[0]
        assert goal.get("goal_name") == "Integration Test Goal"
        assert float(goal.get("target_amount", 0)) == 10000.0
