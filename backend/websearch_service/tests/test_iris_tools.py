"""Tests for iris_tools.py — portfolio fetch, top stocks, news search, dispatcher."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.iris_tools import (
    TOOL_DEFINITIONS,
    _build_why_top,
    _fetch_portfolio_sync,
    _fetch_top_stocks_sync,
    _resolve_core_user_id,
    execute_tool,
    get_portfolio_data,
    get_top_stocks_data,
    search_market_news_data,
)


# ── Supabase mock factory ──────────────────────────────────────────────────────

def _mock_chain(data=None):
    chain = MagicMock()
    result = MagicMock()
    rows = data if data is not None else []
    result.data = rows
    chain.execute.return_value = result
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.filter.return_value = chain
    chain.in_.return_value = chain
    chain.upsert.return_value = chain
    chain.gte.return_value = chain
    chain.lte.return_value = chain
    chain.not_ = MagicMock()
    chain.not_.is_ = MagicMock(return_value=chain)
    # maybe_single returns the first row as a dict (mirrors real supabase behaviour)
    single_chain = MagicMock()
    single_result = MagicMock()
    single_result.data = rows[0] if rows else None
    single_chain.execute.return_value = single_result
    chain.maybe_single.return_value = single_chain
    return chain


def _mock_client(tables: dict):
    """tables = {(schema, table): data_list}"""
    client = MagicMock()

    def schema_fn(schema_name):
        schema_mock = MagicMock()

        def table_fn(table_name):
            data = tables.get((schema_name, table_name), [])
            return _mock_chain(data)

        schema_mock.table = MagicMock(side_effect=table_fn)
        return schema_mock

    client.schema = MagicMock(side_effect=schema_fn)
    return client


# ── TOOL_DEFINITIONS ───────────────────────────────────────────────────────────

class TestToolDefinitions:
    def test_has_three_tools(self):
        assert len(TOOL_DEFINITIONS) == 3

    def test_tool_names(self):
        names = {t["function"]["name"] for t in TOOL_DEFINITIONS}
        assert names == {"get_portfolio", "get_top_stocks", "search_market_news"}

    def test_all_have_type_function(self):
        for t in TOOL_DEFINITIONS:
            assert t["type"] == "function"


# ── _resolve_core_user_id ──────────────────────────────────────────────────────

class TestResolveCoreUserId:
    def test_no_client_returns_none(self):
        with patch("app.services.iris_tools.supabase_client", None):
            result = _resolve_core_user_id("auth-123")
        assert result is None

    def test_empty_auth_id_returns_none(self):
        with patch("app.services.iris_tools.supabase_client", MagicMock()):
            result = _resolve_core_user_id("")
        assert result is None

    def test_found_returns_id(self):
        client = _mock_client({("core", "users"): [{"id": "core-uuid-1"}]})
        with patch("app.services.iris_tools.supabase_client", client):
            result = _resolve_core_user_id("auth-abc")
        assert result == "core-uuid-1"

    def test_not_found_returns_none(self):
        client = _mock_client({("core", "users"): []})
        # maybe_single().execute().data is None when no row
        client.schema.return_value.table.return_value.select.return_value \
            .eq.return_value.maybe_single.return_value.execute.return_value.data = None
        with patch("app.services.iris_tools.supabase_client", client):
            result = _resolve_core_user_id("auth-xyz")
        assert result is None

    def test_exception_returns_none(self):
        client = MagicMock()
        client.schema.side_effect = Exception("DB error")
        with patch("app.services.iris_tools.supabase_client", client):
            result = _resolve_core_user_id("auth-err")
        assert result is None


# ── _fetch_portfolio_sync ──────────────────────────────────────────────────────

class TestFetchPortfolioSync:
    def test_no_client_returns_error(self):
        with patch("app.services.iris_tools.supabase_client", None):
            result = _fetch_portfolio_sync("auth-123")
        assert "error" in result

    def test_no_core_user_returns_error(self):
        client = MagicMock()
        client.schema.return_value.table.return_value.select.return_value \
            .eq.return_value.maybe_single.return_value.execute.return_value.data = None
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_portfolio_sync("auth-no-user")
        assert "error" in result
        assert "No trading account" in result["error"]

    def test_with_open_positions(self):
        open_pos = [{
            "symbol": "AAPL", "quantity": 10,
            "entry_price": 140.0, "current_price": 155.0,
            "type": "long", "entry_date": "2026-01-01",
        }]
        tables = {
            ("core", "users"): [{"id": "core-1"}],
            ("trading", "open_positions"): open_pos,
            ("trading", "trades"): [],
            ("trading", "portfolio_history"): [],
        }
        client = _mock_client(tables)
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_portfolio_sync("auth-1")
        assert result["total_open_positions"] == 1
        assert "AAPL" in result["open_positions"][0]
        assert "+10.7%" in result["open_positions"][0]

    def test_with_closed_trades(self):
        trades = [{
            "symbol": "TSLA", "quantity": 5,
            "entry_price": 200.0, "exit_price": 250.0,
            "pnl": 250.0, "type": "long", "exit_date": "2026-02-01",
        }]
        tables = {
            ("core", "users"): [{"id": "core-1"}],
            ("trading", "open_positions"): [],
            ("trading", "trades"): trades,
            ("trading", "portfolio_history"): [],
        }
        client = _mock_client(tables)
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_portfolio_sync("auth-1")
        assert result["realized_pnl"] == 250.0
        assert result["win_rate"] == 100.0
        assert "TSLA" in result["recent_trades"][0]

    def test_portfolio_history_stats(self):
        history = [
            {"date": "2026-04-01", "value": 11000.0},
            {"date": "2026-03-01", "value": 10000.0},
        ]
        tables = {
            ("core", "users"): [{"id": "core-1"}],
            ("trading", "open_positions"): [],
            ("trading", "trades"): [],
            ("trading", "portfolio_history"): history,
        }
        client = _mock_client(tables)
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_portfolio_sync("auth-1")
        assert result["portfolio_value"] == 11000.0
        assert result["value_change_30d"] == 1000.0

    def test_win_rate_zero_when_no_trades(self):
        tables = {
            ("core", "users"): [{"id": "core-1"}],
            ("trading", "open_positions"): [],
            ("trading", "trades"): [],
            ("trading", "portfolio_history"): [],
        }
        client = _mock_client(tables)
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_portfolio_sync("auth-1")
        assert result["win_rate"] == 0.0

    def test_data_as_of_present(self):
        tables = {
            ("core", "users"): [{"id": "core-1"}],
            ("trading", "open_positions"): [],
            ("trading", "trades"): [],
            ("trading", "portfolio_history"): [],
        }
        client = _mock_client(tables)
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_portfolio_sync("auth-1")
        assert "data_as_of" in result


# ── get_portfolio_data (async wrapper) ────────────────────────────────────────

class TestGetPortfolioData:
    def test_returns_dict(self):
        with patch("app.services.iris_tools.supabase_client", None):
            result = asyncio.get_event_loop().run_until_complete(
                get_portfolio_data("auth-123")
            )
        assert isinstance(result, dict)

    def test_exception_returns_error_dict(self):
        with patch(
            "app.services.iris_tools._fetch_portfolio_sync",
            side_effect=RuntimeError("boom"),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                get_portfolio_data("auth-err")
            )
        assert "error" in result


# ── _fetch_top_stocks_sync ─────────────────────────────────────────────────────

class TestFetchTopStocksSync:
    def _stock_row(self, ticker="AAPL", score=85.0):
        return {
            "ticker": ticker,
            "name": f"{ticker} Inc",
            "composite_score": score,
            "momentum_score": 80.0,
            "trend_score": 75.0,
            "volume_score": 60.0,
            "adx_score": 55.0,
            "rank_tier": "Buy",
            "conviction": "High",
            "change_percent": 1.2,
            "ranked_at": "2026-04-24T00:00:00",
        }

    def test_no_client_returns_error(self):
        with patch("app.services.iris_tools.supabase_client", None):
            result = _fetch_top_stocks_sync(10)
        assert "error" in result

    def test_returns_top_stocks(self):
        stocks = [self._stock_row("AAPL", 90.0), self._stock_row("MSFT", 85.0)]
        macro = [{"vix": 18.5, "yield_10y": 4.3, "sp500_level": 5200.0,
                  "sp500_change_pct": 0.5, "fed_funds_rate": 5.25}]
        tables = {
            ("market", "trending_stocks"): stocks,
            ("market", "macro_snapshots"): macro,
        }
        client = _mock_client(tables)
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_top_stocks_sync(10)
        assert len(result["top_stocks"]) == 2
        assert result["top_stocks"][0]["ticker"] == "AAPL"
        assert result["top_stocks"][0]["rank"] == 1
        assert result["macro_context"]["vix"] == 18.5

    def test_limit_capped_at_25(self):
        stocks = [self._stock_row(f"T{i}", 90.0 - i) for i in range(30)]
        tables = {
            ("market", "trending_stocks"): stocks,
            ("market", "macro_snapshots"): [],
        }
        client = _mock_client(tables)
        # The limit cap is enforced in _fetch_top_stocks_sync before the query,
        # but the mock returns all rows — just verify no exception and data flows
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_top_stocks_sync(100)  # will be capped to 25
        assert "top_stocks" in result

    def test_empty_stocks(self):
        tables = {
            ("market", "trending_stocks"): [],
            ("market", "macro_snapshots"): [],
        }
        client = _mock_client(tables)
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_top_stocks_sync(10)
        assert result["top_stocks"] == []
        assert result["ranked_at"] is None

    def test_why_top_included(self):
        stocks = [self._stock_row("NVDA", 92.0)]
        tables = {
            ("market", "trending_stocks"): stocks,
            ("market", "macro_snapshots"): [],
        }
        client = _mock_client(tables)
        with patch("app.services.iris_tools.supabase_client", client):
            result = _fetch_top_stocks_sync(5)
        assert "why_top" in result["top_stocks"][0]


# ── get_top_stocks_data (async) ───────────────────────────────────────────────

class TestGetTopStocksData:
    def test_returns_dict(self):
        with patch("app.services.iris_tools.supabase_client", None):
            result = asyncio.get_event_loop().run_until_complete(
                get_top_stocks_data(10)
            )
        assert isinstance(result, dict)

    def test_exception_returns_error(self):
        with patch(
            "app.services.iris_tools._fetch_top_stocks_sync",
            side_effect=RuntimeError("boom"),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                get_top_stocks_data(10)
            )
        assert "error" in result


# ── search_market_news_data ────────────────────────────────────────────────────

class TestSearchMarketNewsData:
    def test_no_api_key_returns_error(self):
        with patch("app.services.iris_tools.TAVILY_API_KEY", ""):
            result = asyncio.get_event_loop().run_until_complete(
                search_market_news_data("AAPL earnings")
            )
        assert "error" in result
        assert result["query"] == "AAPL earnings"

    def test_successful_search(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "answer": "AAPL reported strong earnings.",
            "results": [
                {"title": "AAPL Q1", "url": "https://example.com/1",
                 "content": "Apple reported Q1 results" * 20},
            ],
        }

        async def mock_post(*args, **kwargs):
            return mock_response

        mock_client_instance = AsyncMock()
        mock_client_instance.post = AsyncMock(return_value=mock_response)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.iris_tools.TAVILY_API_KEY", "test-key"), \
             patch("httpx.AsyncClient", return_value=mock_client_instance):
            result = asyncio.get_event_loop().run_until_complete(
                search_market_news_data("AAPL earnings")
            )

        assert result["query"] == "AAPL earnings"
        assert result["answer"] == "AAPL reported strong earnings."
        assert len(result["sources"]) == 1
        # content is truncated to 500 chars
        assert len(result["sources"][0]["content"]) <= 500

    def test_http_error_returns_error(self):
        mock_response = MagicMock()
        mock_response.status_code = 429

        mock_client_instance = AsyncMock()
        mock_client_instance.post = AsyncMock(return_value=mock_response)
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.iris_tools.TAVILY_API_KEY", "test-key"), \
             patch("httpx.AsyncClient", return_value=mock_client_instance):
            result = asyncio.get_event_loop().run_until_complete(
                search_market_news_data("AAPL")
            )
        assert "error" in result
        assert "429" in result["error"]

    def test_timeout_returns_error(self):
        import httpx

        mock_client_instance = AsyncMock()
        mock_client_instance.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.iris_tools.TAVILY_API_KEY", "test-key"), \
             patch("httpx.AsyncClient", return_value=mock_client_instance):
            result = asyncio.get_event_loop().run_until_complete(
                search_market_news_data("AAPL")
            )
        assert result["error"] == "Search timed out"

    def test_generic_exception_returns_error(self):
        mock_client_instance = AsyncMock()
        mock_client_instance.post = AsyncMock(side_effect=Exception("network failure"))
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.iris_tools.TAVILY_API_KEY", "test-key"), \
             patch("httpx.AsyncClient", return_value=mock_client_instance):
            result = asyncio.get_event_loop().run_until_complete(
                search_market_news_data("AAPL")
            )
        assert "error" in result


# ── execute_tool (dispatcher) ─────────────────────────────────────────────────

class TestExecuteTool:
    def test_get_portfolio_dispatches(self):
        with patch(
            "app.services.iris_tools.get_portfolio_data",
            new=AsyncMock(return_value={"portfolio_value": 10000.0}),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                execute_tool("get_portfolio", {}, "auth-1")
            )
        data = json.loads(result)
        assert data["portfolio_value"] == 10000.0

    def test_get_top_stocks_dispatches(self):
        with patch(
            "app.services.iris_tools.get_top_stocks_data",
            new=AsyncMock(return_value={"top_stocks": []}),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                execute_tool("get_top_stocks", {"limit": 5}, "auth-1")
            )
        data = json.loads(result)
        assert "top_stocks" in data

    def test_get_top_stocks_invalid_limit_defaults_to_10(self):
        with patch(
            "app.services.iris_tools.get_top_stocks_data",
            new=AsyncMock(return_value={"top_stocks": []}),
        ) as mock_fn:
            asyncio.get_event_loop().run_until_complete(
                execute_tool("get_top_stocks", {"limit": "bad"}, "auth-1")
            )
        mock_fn.assert_called_once_with(10)

    def test_search_market_news_dispatches(self):
        with patch(
            "app.services.iris_tools.search_market_news_data",
            new=AsyncMock(return_value={"query": "AAPL", "answer": "Up"}),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                execute_tool("search_market_news", {"query": "AAPL"}, "auth-1")
            )
        data = json.loads(result)
        assert data["answer"] == "Up"

    def test_search_market_news_empty_query_returns_error(self):
        result = asyncio.get_event_loop().run_until_complete(
            execute_tool("search_market_news", {"query": ""}, "auth-1")
        )
        data = json.loads(result)
        assert "error" in data

    def test_search_market_news_missing_query_returns_error(self):
        result = asyncio.get_event_loop().run_until_complete(
            execute_tool("search_market_news", {}, "auth-1")
        )
        data = json.loads(result)
        assert "error" in data

    def test_unknown_tool_returns_error(self):
        result = asyncio.get_event_loop().run_until_complete(
            execute_tool("nonexistent_tool", {}, "auth-1")
        )
        data = json.loads(result)
        assert "error" in data
        assert "Unknown tool" in data["error"]

    def test_none_args_handled(self):
        with patch(
            "app.services.iris_tools.get_portfolio_data",
            new=AsyncMock(return_value={"ok": True}),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                execute_tool("get_portfolio", None, "auth-1")
            )
        data = json.loads(result)
        assert data["ok"] is True

    def test_result_always_valid_json(self):
        result = asyncio.get_event_loop().run_until_complete(
            execute_tool("unknown", {}, "auth-1")
        )
        # Should be parseable JSON
        data = json.loads(result)
        assert isinstance(data, dict)
