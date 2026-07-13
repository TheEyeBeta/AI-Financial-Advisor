"""Tests for correlation ID middleware."""

from __future__ import annotations

from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.correlation import CorrelationIdMiddleware, redact_mapping


def test_redact_mapping_masks_sensitive_fields():
    payload = redact_mapping(
        {
            "authorization": "Bearer secret",
            "nested": {"token": "abc", "ok": "value"},
        }
    )
    assert payload["authorization"] == "[REDACTED]"
    assert payload["nested"]["token"] == "[REDACTED]"
    assert payload["nested"]["ok"] == "value"


def test_correlation_middleware_propagates_header():
    app = FastAPI()
    app.add_middleware(CorrelationIdMiddleware)

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    client = TestClient(app)
    resp = client.get("/ping", headers={"X-Request-ID": "corr-test-123"})
    assert resp.status_code == 200
    assert resp.headers.get("X-Request-ID") == "corr-test-123"


def test_correlation_middleware_generates_id_when_missing():
    app = FastAPI()
    app.add_middleware(CorrelationIdMiddleware)

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    client = TestClient(app)
    resp = client.get("/ping")
    assert resp.status_code == 200
    assert resp.headers.get("X-Request-ID")


def test_log_event_structured_in_production(monkeypatch):
    from app.middleware import correlation as correlation_module

    monkeypatch.setenv("ENVIRONMENT", "production")
    with patch.object(correlation_module._logger, "info") as info_mock:
        correlation_module.log_event("unit_test", route="/health")
    info_mock.assert_called_once()
    assert '"event": "unit_test"' in info_mock.call_args.args[0]
