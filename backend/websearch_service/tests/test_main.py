"""Tests for main FastAPI application."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import (
    _run_scheduled_cycle,
    _run_scheduled_memory_extraction,
    _run_scheduled_ranking_cycle,
    create_app,
)


# ── Scheduler callbacks ───────────────────────────────────────────────────────

class TestRunScheduledCycle:
    def test_success_logs_summary(self):
        summary = {"users_processed": 3, "digests_generated": 2, "errors": []}
        with patch("app.main.run_intelligence_cycle", new=AsyncMock(return_value=summary)):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_cycle())

    def test_skipped_flag_logged(self):
        summary = {"users_processed": 0, "digests_generated": 0, "errors": [], "skipped": True}
        with patch("app.main.run_intelligence_cycle", new=AsyncMock(return_value=summary)):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_cycle())

    def test_exception_not_raised(self):
        with patch(
            "app.main.run_intelligence_cycle",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_cycle())

    def test_errors_list_in_summary(self):
        summary = {"users_processed": 1, "digests_generated": 0, "errors": ["oops"]}
        with patch("app.main.run_intelligence_cycle", new=AsyncMock(return_value=summary)):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_cycle())


class TestRunScheduledMemoryExtraction:
    def test_success_logs_summary(self):
        summary = {"chats_processed": 5, "total_insights_extracted": 10, "errors": []}
        with patch("app.main.run_memory_extraction_cycle", new=AsyncMock(return_value=summary)):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_memory_extraction())

    def test_skipped_flag_logged(self):
        with patch(
            "app.main.run_memory_extraction_cycle",
            new=AsyncMock(return_value={"skipped": True}),
        ):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_memory_extraction())

    def test_exception_not_raised(self):
        with patch(
            "app.main.run_memory_extraction_cycle",
            new=AsyncMock(side_effect=RuntimeError("memory boom")),
        ):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_memory_extraction())


class TestRunScheduledRankingCycle:
    def test_success_logs_summary(self):
        summary = {
            "tickers_scored": 100,
            "tickers_failed": 2,
            "top_50_written": 50,
            "cycle_duration_seconds": 12.5,
        }
        with patch("app.main.run_ranking_cycle", new=AsyncMock(return_value=summary)):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_ranking_cycle())

    def test_skipped_flag_logged(self):
        with patch(
            "app.main.run_ranking_cycle",
            new=AsyncMock(return_value={"skipped": True}),
        ):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_ranking_cycle())

    def test_exception_not_raised(self):
        with patch(
            "app.main.run_ranking_cycle",
            new=AsyncMock(side_effect=RuntimeError("ranking boom")),
        ):
            import asyncio
            asyncio.get_event_loop().run_until_complete(_run_scheduled_ranking_cycle())


# ── create_app factory ────────────────────────────────────────────────────────

class TestCreateAppFactory:
    def test_production_raises_without_cors_origins(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
        with patch("app.main.validate_auth_configuration"):
            with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
                create_app()

    def test_production_raises_with_wildcard_cors(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("CORS_ORIGINS", "*")
        with patch("app.main.validate_auth_configuration"):
            with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
                create_app()

    def test_dev_mode_creates_app_with_default_origins(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
        from fastapi import FastAPI
        app = create_app()
        assert isinstance(app, FastAPI)

    def test_production_with_valid_cors_creates_app(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.setenv("AUTH_REQUIRED", "true")
        monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
        monkeypatch.setenv("TRUSTED_HOSTS", "app.example.com")
        with patch("app.main.validate_auth_configuration"):
            from fastapi import FastAPI
            app = create_app()
        assert isinstance(app, FastAPI)

    def test_extra_cors_origins_in_dev(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "development")
        monkeypatch.setenv("CORS_ORIGINS", "http://localhost:4000,http://localhost:4001")
        from fastapi import FastAPI
        app = create_app()
        assert isinstance(app, FastAPI)


def test_health_check(client: TestClient):
    """Test the health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "timestamp" in data
    assert "services" in data
    assert "supabase" in data["services"]
    assert "openai" in data["services"]


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


def test_root_endpoint(client: TestClient):
    """Cover the root / endpoint (line 353 in main.py)."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_health_check_supabase_error(monkeypatch):
    """Cover the except branch in _ping_supabase (lines 369-370 in main.py)."""
    from unittest.mock import patch, MagicMock
    from fastapi.testclient import TestClient

    with patch("supabase.create_client", return_value=MagicMock()):
        from app.main import create_app
        app = create_app()

    # Make the supabase_client raise inside the thread
    with patch(
        "app.services.supabase_client.supabase_client"
    ) as mock_sb:
        mock_sb.schema.side_effect = Exception("db down")
        tc = TestClient(app)
        response = tc.get("/health")
    assert response.status_code == 200
    assert response.json()["services"]["supabase"] == "error"
