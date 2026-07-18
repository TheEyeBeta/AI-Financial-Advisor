"""Tests for app.services.ai_cost_reconciliation — scheduled reconciliation
against the OpenAI Costs API. Per requirement #13/#15, this must never
raise and must never touch the local budget guard's hard-stop enforcement;
these tests assert exactly that contract using mocked HTTP, no real
provider calls.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.ai_cost_reconciliation import reconcile_openai_costs


@pytest.mark.asyncio
async def test_skips_when_admin_key_not_configured(monkeypatch):
    monkeypatch.delenv("OPENAI_ADMIN_API_KEY", raising=False)
    result = await reconcile_openai_costs()
    assert result["status"] == "skipped"


@pytest.mark.asyncio
async def test_network_failure_is_reported_not_raised(monkeypatch):
    monkeypatch.setenv("OPENAI_ADMIN_API_KEY", "sk-admin-test")

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("boom"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        with patch("app.services.ai_cost_reconciliation.audit_log", new=AsyncMock()):
            result = await reconcile_openai_costs()

    assert result["status"] == "error"


@pytest.mark.asyncio
async def test_successful_reconciliation_reports_drift(monkeypatch):
    monkeypatch.setenv("OPENAI_ADMIN_API_KEY", "sk-admin-test")

    payload = {
        "data": [
            {"results": [{"amount": {"value": 1.5, "currency": "usd"}}]},
            {"results": [{"amount": {"value": 0.5, "currency": "usd"}}]},
        ]
    }
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = payload

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=mock_client):
        with patch("app.services.ai_cost_reconciliation.audit_log", new=AsyncMock()):
            with patch(
                "app.services.ai_cost_reconciliation.ai_budget_guard.get_status",
                return_value={"day_spend_usd": 1.8},
            ):
                result = await reconcile_openai_costs()

    assert result["status"] == "ok"
    assert result["provider_reported_usd"] == 2.0
    assert result["internal_tracked_usd"] == 1.8
    assert result["drift_usd"] == pytest.approx(0.2, abs=1e-6)
