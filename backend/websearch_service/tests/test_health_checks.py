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
    assert revision == "0045_scheduler_lock_renew"


def test_expected_schema_revision_is_independent_of_cwd(monkeypatch, tmp_path):
    """Head resolution must not depend on the process launch directory (#208).

    alembic.ini's script_location/prepend_sys_path resolve via the %(here)s
    token (the ini file's own directory), not the process cwd — the deployed
    image has no repo checkout to coincidentally match against, and Railway
    does not guarantee any particular working directory at launch.
    """
    from app import health_checks

    health_checks._expected_revision_cache = None
    monkeypatch.chdir(tmp_path)
    try:
        revision = health_checks.expected_schema_revision()
    finally:
        health_checks._expected_revision_cache = None
    assert revision == "0045_scheduler_lock_renew"


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
async def test_schema_revision_check_failure_never_leaks_connection_details():
    """A DB/connection failure while checking schema revision must surface only
    the exception *type*, never its message — which for a DB client can embed
    the DSN, host, or credentials (Gate 1: no secrets in health output)."""
    from app import health_checks

    connection_details = "postgresql://svc_user:test-only-marker@db.internal.example:5432/prod"

    class _Client:
        def schema(self, *_a):
            raise ConnectionError(f"could not connect to {connection_details}")

    with patch("app.services.supabase_client.supabase_client", _Client()):
        result = await health_checks._check_schema_revision(timeout=2)

    assert result["status"] == "unknown"
    assert result["detail"] == "ConnectionError"
    serialized = str(result)
    assert "test-only-marker" not in serialized
    assert "svc_user" not in serialized
    assert "db.internal.example" not in serialized


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


# ── Release identity (exact-SHA release verification) ────────────────────────

def test_release_info_reports_env_identity(monkeypatch):
    from app import health_checks

    monkeypatch.setenv("GIT_SHA", "abc1234def")
    monkeypatch.setenv("APP_VERSION", "1.2.3")
    monkeypatch.setenv("BUILD_TIMESTAMP", "2026-07-16T00:00:00Z")
    monkeypatch.setenv("ENVIRONMENT", "staging")

    info = health_checks.release_info()
    assert info["git_sha"] == "abc1234def"
    assert info["app_version"] == "1.2.3"
    assert info["build_timestamp"] == "2026-07-16T00:00:00Z"
    assert info["environment"] == "staging"
    # The expected schema revision must match the shipped alembic head.
    assert info["expected_schema_revision"] == health_checks.expected_schema_revision()


def test_release_info_reports_production_identity(monkeypatch):
    """ENVIRONMENT=production must report release.environment=production —
    and, symmetrically with the staging test above, never the reverse: a
    staging deploy must never surface as production (Gate 1)."""
    from app import health_checks

    monkeypatch.setenv("ENVIRONMENT", "production")
    assert health_checks.release_info()["environment"] == "production"


def test_release_info_falls_back_to_railway_sha_and_nulls(monkeypatch):
    from app import health_checks

    monkeypatch.delenv("GIT_SHA", raising=False)
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "railway999")
    monkeypatch.delenv("BUILD_TIMESTAMP", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)

    info = health_checks.release_info()
    assert info["git_sha"] == "railway999"
    assert info["build_timestamp"] is None
    assert info["environment"] == "development"

    # No SHA source at all → null, never a guessed value.
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)
    assert health_checks.release_info()["git_sha"] is None


def test_health_endpoint_exposes_release_identity(client: TestClient, monkeypatch):
    monkeypatch.setenv("GIT_SHA", "deadbeef00")
    response = client.get("/health")
    assert response.status_code == 200
    release = response.json()["release"]
    assert release["git_sha"] == "deadbeef00"
    # Never leak secrets through release metadata.
    assert all(
        "key" not in k.lower() and "secret" not in k.lower() and "token" not in k.lower()
        for k in release
    )
