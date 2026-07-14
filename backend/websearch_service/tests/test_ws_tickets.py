"""Tests for app.services.ws_tickets — single-use WebSocket tickets (#205)."""
from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import ws_tickets
from app.services.ws_tickets import (
    DEFAULT_TICKET_TTL_SECONDS,
    InMemoryTicketBackend,
    WebSocketTicketStore,
    get_ws_ticket_store,
    reset_ws_ticket_store,
    ticket_ttl_seconds,
)

from .conftest import _make_jwt


@pytest.fixture(autouse=True)
def _fresh_store():
    reset_ws_ticket_store()
    yield
    reset_ws_ticket_store()


def _memory_store() -> WebSocketTicketStore:
    return WebSocketTicketStore(InMemoryTicketBackend())


# ─── ticket_ttl_seconds ──────────────────────────────────────────────────────

def test_ttl_defaults_when_unset(monkeypatch):
    monkeypatch.delenv("WS_TICKET_TTL_SECONDS", raising=False)
    assert ticket_ttl_seconds() == DEFAULT_TICKET_TTL_SECONDS


def test_ttl_clamped_to_bounds(monkeypatch):
    monkeypatch.setenv("WS_TICKET_TTL_SECONDS", "1")
    assert ticket_ttl_seconds() == 5
    monkeypatch.setenv("WS_TICKET_TTL_SECONDS", "9999")
    assert ticket_ttl_seconds() == 300


def test_ttl_ignores_garbage(monkeypatch):
    monkeypatch.setenv("WS_TICKET_TTL_SECONDS", "not-a-number")
    assert ticket_ttl_seconds() == DEFAULT_TICKET_TTL_SECONDS


# ─── issue / consume ─────────────────────────────────────────────────────────

def test_issue_and_consume_roundtrip():
    store = _memory_store()
    ticket, expires_in = store.issue(user_id="user-1", endpoint="/ws/live", email="x@y.z")
    assert expires_in > 0
    claims = store.consume(ticket, endpoint="/ws/live")
    assert claims is not None
    assert claims.user_id == "user-1"
    assert claims.email == "x@y.z"


def test_consume_is_single_use():
    store = _memory_store()
    ticket, _ = store.issue(user_id="user-1", endpoint="/ws/live")
    assert store.consume(ticket, endpoint="/ws/live") is not None
    # Replay must fail.
    assert store.consume(ticket, endpoint="/ws/live") is None


def test_consume_rejects_unknown_and_malformed_tickets():
    store = _memory_store()
    assert store.consume("never-issued", endpoint="/ws/live") is None
    assert store.consume("", endpoint="/ws/live") is None
    assert store.consume("x" * 300, endpoint="/ws/live") is None


def test_consume_rejects_wrong_endpoint_and_burns_ticket():
    store = _memory_store()
    ticket, _ = store.issue(user_id="user-1", endpoint="/ws/live")
    assert store.consume(ticket, endpoint="/ws/other") is None
    # A mismatched attempt still consumes the ticket — no second chance.
    assert store.consume(ticket, endpoint="/ws/live") is None


def test_expired_ticket_rejected(monkeypatch):
    backend = InMemoryTicketBackend()
    store = WebSocketTicketStore(backend)
    ticket, _ = store.issue(user_id="user-1", endpoint="/ws/live")

    # Jump the clock past every possible TTL.
    real_monotonic = time.monotonic
    monkeypatch.setattr(ws_tickets.time, "monotonic", lambda: real_monotonic() + 3600)
    assert store.consume(ticket, endpoint="/ws/live") is None


def test_tickets_are_stored_hashed():
    backend = InMemoryTicketBackend()
    store = WebSocketTicketStore(backend)
    ticket, _ = store.issue(user_id="user-1", endpoint="/ws/live")
    # The raw ticket value must not appear in storage keys.
    assert all(ticket not in key for key in backend._entries)


def test_tickets_are_unpredictable_and_distinct():
    store = _memory_store()
    t1, _ = store.issue(user_id="user-1", endpoint="/ws/live")
    t2, _ = store.issue(user_id="user-1", endpoint="/ws/live")
    assert t1 != t2
    assert len(t1) >= 32


def test_consume_survives_backend_failure():
    class _BrokenBackend:
        def consume(self, key):
            raise ConnectionError("redis down")

    store = WebSocketTicketStore(_BrokenBackend())
    assert store.consume("anything", endpoint="/ws/live") is None


def test_get_store_falls_back_to_memory_without_redis(monkeypatch):
    monkeypatch.setattr(ws_tickets, "get_rate_limit_redis_client", lambda: None)
    store = get_ws_ticket_store()
    assert isinstance(store._backend, InMemoryTicketBackend)


# ─── HTTP issue + WebSocket consume, end to end ──────────────────────────────

def _authed_client(monkeypatch) -> TestClient:
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    return TestClient(create_app())


def test_ticket_endpoint_requires_auth(monkeypatch):
    client = _authed_client(monkeypatch)
    resp = client.post("/api/v1/ws/ticket")
    assert resp.status_code == 401


def test_ticket_flow_end_to_end(monkeypatch):
    client = _authed_client(monkeypatch)
    jwt = _make_jwt(role="authenticated", sub="e2e-user")

    resp = client.post("/api/v1/ws/ticket", headers={"Authorization": f"Bearer {jwt}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["endpoint"] == "/ws/live"
    assert body["expires_in"] > 0
    ticket = body["ticket"]

    with client.websocket_connect(f"/ws/live?ticket={ticket}") as ws:
        first = ws.receive_json()
        assert first["type"] == "connected"

    # Replay of the consumed ticket must be rejected with the auth close code.
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(f"/ws/live?ticket={ticket}"):
            pass
    assert excinfo.value.code == 4401


def test_websocket_rejects_jwt_query_param(monkeypatch):
    client = _authed_client(monkeypatch)
    jwt = _make_jwt(role="authenticated", sub="qs-user")

    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(f"/ws/live?token={jwt}"):
            pass
    assert excinfo.value.code == 4401


def test_websocket_rejects_bad_origin(monkeypatch):
    client = _authed_client(monkeypatch)
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(
            "/ws/live", headers={"Origin": "https://evil.example.com"}
        ):
            pass
    assert excinfo.value.code == 4403


def test_websocket_accepts_bearer_header(monkeypatch):
    client = _authed_client(monkeypatch)
    jwt = _make_jwt(role="authenticated", sub="hdr-user")

    with client.websocket_connect(
        "/ws/live", headers={"Authorization": f"Bearer {jwt}"}
    ) as ws:
        first = ws.receive_json()
        assert first["type"] == "connected"
