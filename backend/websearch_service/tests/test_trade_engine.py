"""Tests for trade_engine route handlers."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.trade_engine import (
    _query_stock_snapshots,
    router as trade_router,
)


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(trade_router)
    return app


def _mock_dataapi(
    is_configured: bool = True,
    context: dict | None = None,
    signals: dict | None = None,
    health: dict | None = None,
    quotes: dict | None = None,
) -> AsyncMock:
    client = AsyncMock()
    client.is_configured = is_configured
    client.get_advisor_context = AsyncMock(return_value=context or {"tickers": [], "news": []})
    client.get_latest_signals = AsyncMock(return_value=signals or {"signals": []})
    client.check_health = AsyncMock(return_value=health or {"database": True})
    client.get_quotes = AsyncMock(return_value=quotes or {"quotes": []})
    return client


def _sb_client(rows: list) -> MagicMock:
    result = MagicMock()
    result.data = rows
    chain = MagicMock()
    chain.execute.return_value = result
    chain.eq.return_value = chain
    chain.limit.return_value = chain
    chain.select.return_value = chain
    chain.from_.return_value = chain
    schema_mock = MagicMock()
    schema_mock.from_.return_value = chain
    mock_sb = MagicMock()
    mock_sb.schema.return_value = schema_mock
    return mock_sb


# ── GET /api/v1/ai/context ──────────────────────────────────────────────────────

class TestGetAiContext:
    def test_default_source_returns_stub(self):
        client = TestClient(_app())
        resp = client.get("/api/v1/ai/context")
        assert resp.status_code == 200
        data = resp.json()
        assert data["engine_status"]["is_running"] is False
        assert data["tracked_tickers"] == []
        assert "generated_at" in data

    def test_source_dataapi_not_configured_returns_stub(self):
        mock_client = _mock_dataapi(is_configured=False)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/context?source=dataapi")
        assert resp.status_code == 200
        assert resp.json()["engine_status"]["is_running"] is False
        # Since dataapi not configured, falls through to error stub
        assert resp.json()["engine_status"]["active_workers"]["dataapi"] is False

    def test_source_dataapi_returns_live_data(self):
        tickers = [
            {"ticker": "AAPL", "company_name": "Apple", "last_price": 200.0,
             "price_change_pct": 1.5, "volume": 10000, "rsi_14": 55.0,
             "latest_signal": "BUY", "is_bullish": True},
            {"ticker": "MSFT", "latest_signal": "SELL"},
        ]
        news = [{"headline": "Tech rally", "published_at": "2026-04-25T00:00:00Z"}]
        context = {"tickers": tickers, "news": news}
        mock_client = _mock_dataapi(context=context)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/context?source=dataapi")
        assert resp.status_code == 200
        data = resp.json()
        assert data["engine_status"]["is_running"] is True
        assert "AAPL" in data["tracked_tickers"]
        assert len(data["ticker_snapshots"]) == 2
        assert data["summary"]["buy_signals_count"] == 1
        assert data["summary"]["sell_signals_count"] == 1

    def test_source_dataapi_fetch_exception_returns_error_stub(self):
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.get_advisor_context = AsyncMock(side_effect=Exception("API down"))
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/context?source=dataapi")
        assert resp.status_code == 200
        data = resp.json()
        assert data["engine_status"]["is_running"] is False
        assert data["engine_status"]["active_workers"]["dataapi"] is False

    def test_source_auto_dataapi_fails_falls_to_stub(self):
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.get_advisor_context = AsyncMock(side_effect=Exception("API down"))
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/context?source=auto")
        assert resp.status_code == 200
        assert resp.json()["tracked_tickers"] == []

    def test_source_auto_dataapi_succeeds_returns_data(self):
        context = {"tickers": [{"ticker": "NVDA", "latest_signal": "BUY"}], "news": []}
        mock_client = _mock_dataapi(context=context)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/context?source=auto")
        assert resp.status_code == 200
        assert "NVDA" in resp.json()["tracked_tickers"]

    def test_source_dataapi_with_signals(self):
        signals_data = {
            "signals": [{
                "ticker": "AAPL", "signal": "BUY", "strategy_name": "momentum",
                "confidence": 0.85, "timestamp": "2026-04-25T00:00:00Z", "entry_price": 200.0,
            }]
        }
        context = {"tickers": [], "news": []}
        mock_client = _mock_dataapi(context=context, signals=signals_data)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/context?source=dataapi")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["recent_signals"]) == 1
        assert data["recent_signals"][0]["ticker"] == "AAPL"
        assert data["summary"]["signals_last_24h"] == 1

    def test_source_dataapi_signals_exception_graceful(self):
        context = {"tickers": [], "news": []}
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.get_advisor_context = AsyncMock(return_value=context)
        mock_client.get_latest_signals = AsyncMock(side_effect=Exception("signals failed"))
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/context?source=dataapi")
        assert resp.status_code == 200
        assert resp.json()["recent_signals"] == []


# ── GET /api/v1/ai/signals ──────────────────────────────────────────────────────

class TestGetSignals:
    def test_default_source_returns_empty_list(self):
        client = TestClient(_app())
        resp = client.get("/api/v1/ai/signals")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_source_dataapi_not_configured_returns_empty(self):
        mock_client = _mock_dataapi(is_configured=False)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/signals?source=dataapi")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_source_dataapi_returns_signals(self):
        signals = {"signals": [{
            "ticker": "AAPL", "signal": "BUY", "strategy_name": "momentum",
            "confidence": 0.8, "timestamp": "2026-04-25T00:00:00Z", "entry_price": 200.0,
        }]}
        mock_client = _mock_dataapi(signals=signals)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/signals?source=dataapi")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["ticker"] == "AAPL"
        assert data[0]["signal"] == "BUY"

    def test_source_dataapi_signal_type_filter(self):
        signals = {"signals": [
            {"ticker": "AAPL", "signal": "BUY", "strategy_name": "s", "timestamp": "2026-04-25T00:00:00Z"},
            {"ticker": "MSFT", "signal": "SELL", "strategy_name": "s", "timestamp": "2026-04-25T00:00:00Z"},
        ]}
        mock_client = _mock_dataapi(signals=signals)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/signals?source=dataapi&signal_type=BUY")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["signal"] == "BUY"

    def test_source_dataapi_fetch_exception_returns_empty(self):
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.get_latest_signals = AsyncMock(side_effect=Exception("fail"))
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/signals?source=dataapi")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_source_auto_fetch_exception_falls_through_to_empty(self):
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.get_latest_signals = AsyncMock(side_effect=Exception("fail"))
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/signals?source=auto")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_source_dataapi_with_ticker_filter(self):
        signals = {"signals": [
            {"ticker": "AAPL", "signal": "BUY", "strategy_name": "s", "timestamp": "2026-04-25T00:00:00Z"},
        ]}
        mock_client = _mock_dataapi(signals=signals)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/ai/signals?source=dataapi&ticker=AAPL")
        assert resp.status_code == 200
        assert len(resp.json()) == 1


# ── GET /api/v1/engine/status ──────────────────────────────────────────────────

class TestGetEngineStatus:
    def test_default_source_supabase(self):
        client = TestClient(_app())
        resp = client.get("/api/v1/engine/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "supabase"
        assert data["connected"] is False

    def test_source_dataapi_configured_and_healthy(self):
        mock_client = _mock_dataapi(health={"database": True})
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/engine/status?source=dataapi")
        assert resp.status_code == 200
        data = resp.json()
        assert data["connected"] is True
        assert data["source"] == "dataapi"
        assert data["database"] is True

    def test_source_dataapi_not_configured_falls_through(self):
        mock_client = _mock_dataapi(is_configured=False)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/engine/status?source=dataapi")
        assert resp.status_code == 200
        assert resp.json()["source"] == "supabase"

    def test_source_dataapi_health_check_fails(self):
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.check_health = AsyncMock(side_effect=Exception("unreachable"))
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/engine/status?source=dataapi")
        assert resp.status_code == 200
        data = resp.json()
        assert data["connected"] is False
        assert "unreachable" in data["message"]

    def test_source_auto_dataapi_succeeds(self):
        mock_client = _mock_dataapi(health={"database": True})
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/engine/status?source=auto")
        assert resp.status_code == 200
        assert resp.json()["connected"] is True

    def test_source_auto_dataapi_fails_falls_through(self):
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.check_health = AsyncMock(side_effect=Exception("timeout"))
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/v1/engine/status?source=auto")
        assert resp.status_code == 200
        # auto falls through to supabase stub
        assert resp.json()["source"] == "supabase"


# ── GET /api/stock-price/{ticker} ──────────────────────────────────────────────

class TestGetStockPrice:
    def test_no_supabase_client_returns_unavailable(self):
        with patch("app.routes.trade_engine._get_supabase_client", return_value=None):
            client = TestClient(_app())
            resp = client.get("/api/stock-price/AAPL")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ticker"] == "AAPL"
        assert data["source"] == "unavailable"
        assert data["price"] is None

    def test_ticker_uppercased(self):
        with patch("app.routes.trade_engine._get_supabase_client", return_value=None):
            client = TestClient(_app())
            resp = client.get("/api/stock-price/aapl")
        assert resp.json()["ticker"] == "AAPL"

    def test_source_supabase_with_data(self):
        mock_sb = _sb_client([{"last_price": 150.0, "price_change_pct": 0.5, "updated_at": "2026-04-25T00:00:00Z"}])
        with patch("app.routes.trade_engine._get_supabase_client", return_value=mock_sb):
            client = TestClient(_app())
            resp = client.get("/api/stock-price/AAPL")
        assert resp.status_code == 200
        data = resp.json()
        assert data["price"] == 150.0
        assert data["source"] == "supabase"

    def test_source_supabase_no_data_returns_unavailable(self):
        mock_sb = _sb_client([])
        with patch("app.routes.trade_engine._get_supabase_client", return_value=mock_sb):
            client = TestClient(_app())
            resp = client.get("/api/stock-price/AAPL")
        assert resp.json()["source"] == "unavailable"

    def test_source_supabase_exception_returns_unavailable(self):
        mock_sb = MagicMock()
        mock_sb.schema.side_effect = Exception("DB error")
        with patch("app.routes.trade_engine._get_supabase_client", return_value=mock_sb):
            client = TestClient(_app())
            resp = client.get("/api/stock-price/AAPL")
        assert resp.json()["source"] == "unavailable"

    def test_source_dataapi_returns_quote(self):
        quotes = {"quotes": [{"last_price": 200.0, "price_change_pct": 1.5, "updated_at": "2026-04-25T00:00:00Z"}]}
        mock_client = _mock_dataapi(quotes=quotes)
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/stock-price/AAPL?source=dataapi")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ticker"] == "AAPL"
        assert data["price"] == 200.0
        assert data["source"] == "dataapi"

    def test_source_dataapi_no_quotes_falls_to_supabase(self):
        mock_client = _mock_dataapi(quotes={"quotes": []})
        mock_sb = _sb_client([{"last_price": 100.0, "price_change_pct": 0.0, "updated_at": "2026-04-25T00:00:00Z"}])
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client), \
             patch("app.routes.trade_engine._get_supabase_client", return_value=mock_sb):
            client = TestClient(_app())
            resp = client.get("/api/stock-price/AAPL?source=auto")
        assert resp.status_code == 200
        assert resp.json()["price"] == 100.0

    def test_source_dataapi_exception_explicitly_fails(self):
        mock_client = AsyncMock()
        mock_client.is_configured = True
        mock_client.get_quotes = AsyncMock(side_effect=Exception("fail"))
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client):
            client = TestClient(_app())
            resp = client.get("/api/stock-price/AAPL?source=dataapi")
        assert resp.status_code == 200
        assert resp.json()["source"] == "dataapi_error"

    def test_source_auto_dataapi_not_configured_uses_supabase(self):
        mock_client = _mock_dataapi(is_configured=False)
        mock_sb = _sb_client([{"last_price": 50.0, "price_change_pct": 0.1, "updated_at": "2026-04-25T00:00:00Z"}])
        with patch("app.routes.trade_engine.get_dataapi_client", return_value=mock_client), \
             patch("app.routes.trade_engine._get_supabase_client", return_value=mock_sb):
            client = TestClient(_app())
            resp = client.get("/api/stock-price/AAPL?source=auto")
        assert resp.status_code == 200
        assert resp.json()["price"] == 50.0


# ── _query_stock_snapshots ────────────────────────────────────────────────────

class TestQueryStockSnapshots:
    def test_basic_query(self):
        mock_sb = _sb_client([{"ticker": "AAPL", "last_price": 200.0}])
        result = _query_stock_snapshots(mock_sb, ticker="AAPL", limit=1)
        assert result.data[0]["ticker"] == "AAPL"

    def test_query_without_ticker(self):
        mock_sb = _sb_client([{"ticker": "AAPL"}, {"ticker": "MSFT"}])
        result = _query_stock_snapshots(mock_sb)
        assert len(result.data) == 2

    def test_query_without_limit(self):
        mock_sb = _sb_client([{"ticker": "AAPL"}])
        result = _query_stock_snapshots(mock_sb, ticker="AAPL")
        assert result is not None
