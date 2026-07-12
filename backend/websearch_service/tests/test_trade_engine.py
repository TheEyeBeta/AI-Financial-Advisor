"""Tests for app.routes.trade_engine — REST context/signals/status and websocket."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routes import trade_engine as trade_engine_route


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


# ─── /api/v1/ai/context ─────────────────────────────────────────────────────

def test_ai_context_supabase_source_returns_503_when_empty(client: TestClient):
    with patch.object(trade_engine_route, "_build_context_from_supabase", return_value=None):
        resp = client.get("/api/v1/ai/context", params={"source": "supabase"})
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert detail["reason_code"] == "supabase_empty"


def test_ai_context_supabase_source_returns_data_when_available(client: TestClient):
    sample = trade_engine_route.AIContextResponse(
        generated_at="2026-04-24T00:00:00Z",
        engine_status=trade_engine_route.EngineStatus(active_workers={"supabase": True}),
        tracked_tickers=["AAPL"],
        ticker_snapshots=[trade_engine_route.TickerSnapshot(ticker="AAPL", last_price=100.0)],
        summary=trade_engine_route.EngineSummaryFull(total_tracked_tickers=1, tickers_with_data=1),
        data_available=True,
        availability_status="ok",
        data_source="supabase",
    )
    with patch.object(trade_engine_route, "_build_context_from_supabase", return_value=sample):
        resp = client.get("/api/v1/ai/context", params={"source": "supabase"})
    assert resp.status_code == 200
    assert resp.json()["data_available"] is True


def test_ai_context_auto_falls_back_to_supabase(client: TestClient):
    sample = trade_engine_route.AIContextResponse(
        generated_at="2026-04-24T00:00:00Z",
        engine_status=trade_engine_route.EngineStatus(active_workers={"supabase": True}),
        tracked_tickers=["MSFT"],
        ticker_snapshots=[trade_engine_route.TickerSnapshot(ticker="MSFT", last_price=200.0)],
        summary=trade_engine_route.EngineSummaryFull(total_tracked_tickers=1, tickers_with_data=1),
        data_available=True,
        availability_status="ok",
        data_source="supabase",
    )
    with patch.object(
        trade_engine_route, "_build_context_from_dataapi", new=AsyncMock(return_value=None)
    ), patch.object(trade_engine_route, "_build_context_from_supabase", return_value=sample):
        resp = client.get("/api/v1/ai/context", params={"source": "auto"})

    assert resp.status_code == 200
    assert resp.json()["data_source"] == "supabase"


def test_build_context_from_supabase_returns_none_without_client():
    with patch.object(trade_engine_route, "_get_supabase_client", return_value=None):
        assert trade_engine_route._build_context_from_supabase() is None


def test_ai_context_dataapi_source_returns_503_when_unavailable(client: TestClient):
    with patch.object(
        trade_engine_route, "_build_context_from_dataapi", new=AsyncMock(return_value=None)
    ):
        resp = client.get("/api/v1/ai/context", params={"source": "dataapi"})

    assert resp.status_code == 503
    assert resp.json()["detail"]["reason_code"] == "dataapi_unavailable"


# ─── /api/v1/ai/signals ─────────────────────────────────────────────────────

def test_signals_default_returns_503_when_unavailable(client: TestClient):
    resp = client.get("/api/v1/ai/signals")
    assert resp.status_code == 503
    assert resp.json()["detail"]["reason_code"] == "signals_not_configured"


def test_signals_dataapi_applies_signal_type_filter(client: TestClient):
    fake_client = MagicMock()
    fake_client.is_configured = True
    fake_client.get_latest_signals = AsyncMock(return_value={
        "signals": [
            {"ticker": "AAPL", "signal": "BUY", "strategy_name": "momentum",
             "confidence": 0.8, "timestamp": "2026-04-24T00:00:00Z"},
            {"ticker": "TSLA", "signal": "SELL", "strategy_name": "mean_rev",
             "confidence": 0.7, "timestamp": "2026-04-24T00:00:00Z"},
        ]
    })

    with patch.object(trade_engine_route, "get_dataapi_client", return_value=fake_client):
        resp = client.get(
            "/api/v1/ai/signals",
            params={"source": "dataapi", "signal_type": "BUY"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["ticker"] == "AAPL"
    assert data[0]["signal"] == "BUY"


def test_signals_dataapi_returns_502_on_upstream_error(client: TestClient):
    fake_client = MagicMock()
    fake_client.is_configured = True
    fake_client.get_latest_signals = AsyncMock(side_effect=RuntimeError("upstream"))
    with patch.object(trade_engine_route, "get_dataapi_client", return_value=fake_client):
        resp = client.get("/api/v1/ai/signals", params={"source": "dataapi"})

    assert resp.status_code == 502
    assert resp.json()["detail"]["reason_code"] == "dataapi_error"


# ─── /api/v1/engine/status ──────────────────────────────────────────────────

def test_engine_status_default_reports_supabase(client: TestClient):
    resp = client.get("/api/v1/engine/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["connected"] is False
    assert body["source"] == "supabase"


def test_engine_status_dataapi_connected_path(client: TestClient):
    fake_client = MagicMock()
    fake_client.is_configured = True
    fake_client.check_health = AsyncMock(return_value={"database": True})

    with patch.object(trade_engine_route, "get_dataapi_client", return_value=fake_client):
        resp = client.get("/api/v1/engine/status", params={"source": "dataapi"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["connected"] is True
    assert body["database"] is True


def test_engine_status_dataapi_error_reports_unreachable(client: TestClient):
    fake_client = MagicMock()
    fake_client.is_configured = True
    fake_client.check_health = AsyncMock(side_effect=RuntimeError("network"))

    with patch.object(trade_engine_route, "get_dataapi_client", return_value=fake_client):
        resp = client.get("/api/v1/engine/status", params={"source": "dataapi"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["connected"] is False
    assert "unreachable" in body["message"]


# ─── /api/stock-price/{ticker} ──────────────────────────────────────────────

def test_stock_price_default_returns_404_when_no_backend(client: TestClient):
    with patch.object(trade_engine_route, "_get_supabase_client", return_value=None):
        resp = client.get("/api/stock-price/AAPL")

    assert resp.status_code == 404
    assert resp.json()["detail"]["reason_code"] == "price_not_found"


def test_stock_price_dataapi_happy_path(client: TestClient):
    fake_dataapi = MagicMock()
    fake_dataapi.is_configured = True
    fake_dataapi.get_quotes = AsyncMock(return_value={
        "quotes": [{
            "ticker": "AAPL",
            "last_price": 192.5,
            "price_change_pct": 1.2,
            "updated_at": "2026-04-24T00:00:00Z",
        }]
    })

    with patch.object(trade_engine_route, "get_dataapi_client", return_value=fake_dataapi):
        resp = client.get("/api/stock-price/aapl", params={"source": "dataapi"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["ticker"] == "AAPL"
    assert body["price"] == 192.5
    assert body["source"] == "dataapi"


def test_stock_price_dataapi_error_returns_502(client: TestClient):
    fake_dataapi = MagicMock()
    fake_dataapi.is_configured = True
    fake_dataapi.get_quotes = AsyncMock(side_effect=RuntimeError("bad"))

    with patch.object(trade_engine_route, "get_dataapi_client", return_value=fake_dataapi):
        resp = client.get("/api/stock-price/AAPL", params={"source": "dataapi"})

    assert resp.status_code == 502
    assert resp.json()["detail"]["reason_code"] == "dataapi_error"


# ─── WebSocket /ws/live ─────────────────────────────────────────────────────

def test_websocket_rejects_unauthenticated_connection(monkeypatch):
    # AUTH_REQUIRED=true so the ws handler rejects missing tokens.
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "t" * 32)
    client = TestClient(create_app())

    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect("/ws/live"):
            pass

    assert excinfo.value.code == 4401


def test_websocket_pong_and_subscription_flow(monkeypatch):
    # AUTH_REQUIRED=false bypasses JWT so we can exercise the message pump.
    monkeypatch.setenv("AUTH_REQUIRED", "false")
    monkeypatch.setenv("ENVIRONMENT", "development")
    client = TestClient(create_app())

    with client.websocket_connect("/ws/live") as ws:
        # On connect the server sends two system frames.
        first = ws.receive_json()
        assert first["type"] == "connected"
        second = ws.receive_json()
        assert second["type"] == "engine_status"

        ws.send_text(json.dumps({"action": "ping", "timestamp": 42}))
        pong = ws.receive_json()
        assert pong == {"type": "pong", "timestamp": 42}

        ws.send_text(json.dumps({"action": "subscribe", "tickers": ["aapl", "msft"]}))
        sub = ws.receive_json()
        assert sub["type"] == "subscribed"
        assert sub["tickers"] == ["AAPL", "MSFT"]

        ws.send_text(json.dumps({"action": "get_subscriptions"}))
        listing = ws.receive_json()
        assert listing["type"] == "subscriptions"
        assert set(listing["tickers"]) == {"AAPL", "MSFT"}

        ws.send_text(json.dumps({"action": "unsubscribe", "tickers": ["aapl"]}))
        unsub = ws.receive_json()
        assert unsub["type"] == "unsubscribed"
        assert unsub["tickers"] == ["AAPL"]

        ws.send_text(json.dumps({"action": "mystery"}))
        err = ws.receive_json()
        assert err["type"] == "error"
        assert "Unknown action" in err["message"]

        ws.send_text("not json")
        err2 = ws.receive_json()
        assert err2["type"] == "error"
        assert "Invalid JSON" in err2["message"]
