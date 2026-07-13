"""Tests for admin trigger endpoints — auth guard and durable job enqueue."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routes import admin as admin_route
from .conftest import TEST_JWT_SECRET


def _service_role_app_and_client(monkeypatch) -> TestClient:
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET)
    return TestClient(create_app())


def _service_role_headers(service_role_jwt) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {service_role_jwt}",
        "Idempotency-Key": "test-idempotency-key-001",
    }


@pytest.mark.parametrize(
    "endpoint",
    [
        "/api/admin/trigger-ranking",
        "/api/admin/trigger-memory-scan",
        "/api/admin/trigger-intelligence",
        "/api/admin/trigger-memory-extraction",
        "/api/admin/trigger-meridian-refresh",
    ],
)
def test_trigger_endpoints_reject_missing_token(monkeypatch, endpoint: str):
    client = _service_role_app_and_client(monkeypatch)
    resp = client.post(endpoint)
    assert resp.status_code in (401, 403)


def test_trigger_endpoints_require_idempotency_key(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)
    resp = client.post(
        "/api/admin/trigger-ranking",
        headers={"Authorization": f"Bearer {service_role_jwt}"},
    )
    assert resp.status_code == 400


def test_trigger_ranking_enqueues_durable_job(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)

    with patch.object(
        admin_route,
        "enqueue_admin_job",
        return_value=(
            {
                "id": "job-123",
                "status": "queued",
                "job_type": admin_route.JOB_TYPE_RANKING,
                "correlation_id": "corr-1",
            },
            True,
        ),
    ) as enqueue_mock:
        resp = client.post(
            "/api/admin/trigger-ranking",
            headers=_service_role_headers(service_role_jwt),
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "queued"
    assert body["job_id"] == "job-123"
    assert body["duplicate"] is False
    enqueue_mock.assert_called_once()


def test_trigger_memory_scan_enqueues_with_limit(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)

    with patch.object(
        admin_route,
        "enqueue_admin_job",
        return_value=(
            {
                "id": "job-scan",
                "status": "queued",
                "job_type": admin_route.JOB_TYPE_MEMORY_SCAN,
                "correlation_id": "corr-2",
            },
            True,
        ),
    ) as enqueue_mock:
        resp = client.post(
            "/api/admin/trigger-memory-scan",
            headers=_service_role_headers(service_role_jwt),
        )

    assert resp.status_code == 200
    assert resp.json()["limit"] == 200
    enqueue_mock.assert_called_once()
    assert enqueue_mock.call_args.kwargs["parameters"] == {"limit": 200}


# ─── Admin dataapi-query input validation ─────────────────────────────────

def test_dataapi_query_rejects_non_select(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)
    resp = client.get(
        "/api/admin/dataapi-query",
        params={"q": "DELETE FROM trades"},
        headers={"Authorization": f"Bearer {service_role_jwt}"},
    )
    assert resp.status_code == 400


def test_dataapi_query_rejects_mutation_keywords_inside_cte(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)
    resp = client.get(
        "/api/admin/dataapi-query",
        params={"q": "WITH x AS (DELETE FROM trades) SELECT * FROM x"},
        headers={"Authorization": f"Bearer {service_role_jwt}"},
    )
    assert resp.status_code == 400


def test_dataapi_query_requires_min_length(monkeypatch, service_role_jwt):
    client = _service_role_app_and_client(monkeypatch)
    resp = client.get(
        "/api/admin/dataapi-query",
        params={"q": ""},
        headers={"Authorization": f"Bearer {service_role_jwt}"},
    )
    assert resp.status_code == 422
