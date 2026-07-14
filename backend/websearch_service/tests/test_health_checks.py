"""Tests for readiness and liveness probes."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from app.health_checks import assess_readiness, mark_startup_complete
from app.main import create_app


@pytest.mark.asyncio
async def test_readiness_fails_when_database_down(monkeypatch):
    mark_startup_complete()

    async def _fail_ping(timeout: float):
        return {"status": "error", "detail": "timeout"}

    with patch("app.health_checks._ping_supabase", new=_fail_ping):
        report = await assess_readiness()
    assert report["ready"] is False
    assert report["components"]["database"]["status"] == "error"


@pytest.mark.asyncio
async def test_readiness_ok_when_optional_search_down(monkeypatch):
    mark_startup_complete()
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    report = await assess_readiness()
    assert report["ready"] is True
    assert report["degraded"] is True


def test_liveness_never_calls_external_services(client: TestClient):
    with patch("app.services.supabase_client.supabase_client") as mock_sb:
        response = client.get("/health/live")
        assert response.status_code == 200
        mock_sb.schema.assert_not_called()


# ── Schema-revision readiness (#208) ─────────────────────────────────────────

def test_expected_schema_revision_matches_alembic_head():
    from app import health_checks

    health_checks._expected_revision_cache = None
    revision = health_checks.expected_schema_revision()
    assert revision, "the build must be able to read its own alembic head"
    assert revision.startswith("00")


@pytest.mark.asyncio
async def test_readiness_fails_on_schema_revision_mismatch():
    mark_startup_complete()

    async def _mismatch(timeout: float):
        return {"status": "error", "expected": "0035_x", "actual": "0030_y"}

    with patch("app.health_checks._check_schema_revision", new=_mismatch):
        report = await assess_readiness()
    assert report["ready"] is False
    assert report["components"]["schema_revision"]["status"] == "error"


@pytest.mark.asyncio
async def test_readiness_survives_unknown_schema_revision():
    mark_startup_complete()

    async def _unknown(timeout: float):
        return {"status": "unknown", "detail": "permissions"}

    with patch("app.health_checks._check_schema_revision", new=_unknown):
        report = await assess_readiness()
    # Unknown must not take the service down, but must mark it degraded.
    assert report["components"]["schema_revision"]["status"] == "unknown"
    assert report["degraded"] is True


@pytest.mark.asyncio
async def test_schema_revision_check_reports_ok_on_match():
    from app import health_checks

    expected = health_checks.expected_schema_revision()

    class _Result:
        data = [{"version_num": expected}]

    class _Query:
        def select(self, *_a, **_k):
            return self

        def limit(self, *_a, **_k):
            return self

        def execute(self):
            return _Result()

    class _Client:
        def schema(self, *_a):
            return self

        def table(self, *_a):
            return _Query()

    with patch("app.services.supabase_client.supabase_client", _Client()):
        result = await health_checks._check_schema_revision(timeout=2)
    assert result == {"status": "ok", "revision": expected}
