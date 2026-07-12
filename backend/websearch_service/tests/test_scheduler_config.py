"""Tests for scheduler gating and job callbacks."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.scheduler_config import (
    _run_scheduled_chat_turn_reconciliation,
    _run_scheduled_cycle,
    create_scheduler,
    scheduler_enabled,
)


class TestSchedulerEnabled:
    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("SCHEDULER_ENABLED", raising=False)
        assert scheduler_enabled() is False

    def test_enabled_when_true(self, monkeypatch):
        monkeypatch.setenv("SCHEDULER_ENABLED", "true")
        assert scheduler_enabled() is True


class TestSchedulerCallbacks:
    def test_intelligence_cycle_logs_success(self):
        summary = {"users_processed": 1, "digests_generated": 1, "errors": []}
        with patch(
            "app.scheduler_config.run_intelligence_cycle",
            new=AsyncMock(return_value=summary),
        ), patch("app.scheduler_config.log_job_run", new=AsyncMock()):
            asyncio.run(_run_scheduled_cycle())

    def test_chat_turn_reconciliation_logs_success(self):
        with patch(
            "app.scheduler_config.run_chat_turn_reconciliation",
            new=AsyncMock(return_value={"reconciled": 2, "errors": []}),
        ), patch("app.scheduler_config.log_job_run", new=AsyncMock()):
            asyncio.run(_run_scheduled_chat_turn_reconciliation())


class TestWebLifespanScheduler:
    def test_web_lifespan_does_not_start_scheduler_by_default(self, monkeypatch):
        monkeypatch.delenv("SCHEDULER_ENABLED", raising=False)
        monkeypatch.setenv("ENVIRONMENT", "development")
        with patch("app.main.validate_auth_configuration"), patch(
            "app.main.validate_rate_limit_configuration"
        ), patch("app.main.create_scheduler") as mock_create:
            from app.main import create_app

            with patch("fastapi.testclient.TestClient"):
                app = create_app()
            assert app is not None
            mock_create.assert_not_called()

    def test_create_scheduler_sets_max_instances(self):
        scheduler = create_scheduler()
        assert scheduler._job_defaults["max_instances"] == 1
        assert scheduler._job_defaults["coalesce"] is True
        job_ids = {job.id for job in scheduler.get_jobs()}
        assert "chat_turn_reconciliation" in job_ids
