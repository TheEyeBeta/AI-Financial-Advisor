"""HTTP-level integration tests: the global AI budget guard wired into
/api/chat and the admin status/override endpoints. Unit coverage for the
guard's own logic lives in test_ai_budget_guard.py; this file verifies the
route-layer plumbing (denial → 429/503 JSON with reason code, admin auth,
override endpoints) using the same mocking patterns as test_ai_proxy.py.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.routes import ai_proxy
from app.services.ai_budget_guard import AIBudgetDenied, ai_budget_guard
from app.services.rate_limit import rate_limiter


@pytest.mark.asyncio
async def test_chat_endpoint_returns_429_with_reason_code_on_budget_denial(client: TestClient):
    rate_limiter.clear_state()

    denial = AIBudgetDenied(
        "global_concurrency", "normal", 5, "The AI service is at maximum global capacity. Please retry shortly."
    )
    with patch.object(ai_budget_guard, "reserve", side_effect=denial):
        response = client.post("/api/chat", json={"message": "Hello", "user_id": "test-user"})

    assert response.status_code == 429
    body = response.json()
    assert body["reason_code"] == "global_concurrency"
    assert body["circuit_breaker_state"] == "normal"
    assert "retry_after" in body
    assert response.headers.get("Retry-After") == "5"


@pytest.mark.asyncio
async def test_chat_endpoint_returns_503_on_hard_stop(client: TestClient):
    rate_limiter.clear_state()

    denial = AIBudgetDenied("hard_stop", "hard_stop", 3600, "Budget exhausted.")
    with patch.object(ai_budget_guard, "reserve", side_effect=denial):
        response = client.post("/api/chat", json={"message": "Hello", "user_id": "test-user"})

    assert response.status_code == 503
    body = response.json()
    assert body["reason_code"] == "hard_stop"
    assert body["error"] == "ai_budget_hard_stop"


@pytest.mark.asyncio
async def test_chat_title_endpoint_returns_budget_denial_response(client: TestClient):
    rate_limiter.clear_state()

    denial = AIBudgetDenied("model_concurrency", "normal", 5, "Model is at capacity.")
    with patch.object(ai_budget_guard, "reserve", side_effect=denial):
        response = client.post("/api/chat/title", json={"first_message": "Hello there"})

    assert response.status_code == 429
    assert response.json()["reason_code"] == "model_concurrency"


def test_admin_ai_budget_status_requires_auth(client: TestClient):
    response = client.get("/api/admin/ai-budget/status")
    assert response.status_code == 401


def test_admin_ai_budget_status_returns_status_payload(client: TestClient, service_role_jwt: str):
    response = client.get(
        "/api/admin/ai-budget/status",
        headers={"Authorization": f"Bearer {service_role_jwt}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "state" in body
    assert "day_spend_usd" in body
    assert "month_spend_usd" in body
    # Never expose prompt content or per-user identifiers.
    assert "prompt" not in body
    assert "message" not in body or not isinstance(body.get("message"), str) or "user" not in body


def test_admin_ai_budget_override_set_and_clear(client: TestClient, service_role_jwt: str):
    headers = {"Authorization": f"Bearer {service_role_jwt}"}
    set_response = client.post(
        "/api/admin/ai-budget/override",
        json={"duration_minutes": 5, "reason": "incident testing"},
        headers=headers,
    )
    assert set_response.status_code == 200
    assert set_response.json()["success"] is True

    status_response = client.get("/api/admin/ai-budget/status", headers=headers)
    assert status_response.json()["override_active"] is True

    clear_response = client.delete("/api/admin/ai-budget/override", headers=headers)
    assert clear_response.status_code == 200

    status_after_clear = client.get("/api/admin/ai-budget/status", headers=headers)
    assert status_after_clear.json()["override_active"] is False


def test_admin_ai_budget_override_requires_auth(client: TestClient):
    response = client.post(
        "/api/admin/ai-budget/override",
        json={"duration_minutes": 5, "reason": "no auth"},
    )
    assert response.status_code == 401


def test_admin_ai_budget_reconcile_costs_is_non_fatal_when_unconfigured(
    client: TestClient, service_role_jwt: str, monkeypatch
):
    monkeypatch.delenv("OPENAI_ADMIN_API_KEY", raising=False)
    response = client.post(
        "/api/admin/ai-budget/reconcile-costs",
        headers={"Authorization": f"Bearer {service_role_jwt}"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "skipped"


def test_admin_ai_budget_override_clear_failure_does_not_claim_success(
    client: TestClient, service_role_jwt: str
):
    """Regression: clearing an override used to always report success even
    when the backend mutation failed. It must now surface the failure."""
    from app.services.ai_budget_guard import AIBudgetDenied, ai_budget_guard

    denial = AIBudgetDenied("redis_unavailable", "hard_stop", 30, "backend unavailable")
    with patch.object(ai_budget_guard, "clear_manual_override", side_effect=denial):
        response = client.delete(
            "/api/admin/ai-budget/override",
            headers={"Authorization": f"Bearer {service_role_jwt}"},
        )
    assert response.status_code == 503
    assert "success" not in response.json() or response.json().get("success") is not True


def test_admin_ai_budget_override_set_failure_does_not_claim_success(
    client: TestClient, service_role_jwt: str
):
    from app.services.ai_budget_guard import AIBudgetDenied, ai_budget_guard

    denial = AIBudgetDenied("redis_unavailable", "hard_stop", 30, "backend unavailable")
    with patch.object(ai_budget_guard, "set_manual_override", side_effect=denial):
        response = client.post(
            "/api/admin/ai-budget/override",
            json={"duration_minutes": 5, "reason": "incident"},
            headers={"Authorization": f"Bearer {service_role_jwt}"},
        )
    assert response.status_code == 503
    assert "success" not in response.json() or response.json().get("success") is not True
