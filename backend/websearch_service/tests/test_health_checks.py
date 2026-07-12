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
