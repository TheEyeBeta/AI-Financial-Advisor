"""Tests for the sync Supabase-backed iris_tools fetchers.

Exercises `_fetch_portfolio_sync`, `_fetch_top_stocks_sync`, and
`_resolve_core_user_id` using an in-memory Supabase test double.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services import iris_tools
from app.services.iris_tools import (
    _fetch_portfolio_sync,
    _fetch_top_stocks_sync,
    _resolve_core_user_id,
    get_portfolio_data,
    get_top_stocks_data,
)


class _Chain:
    """Tiny chainable query stand-in that records ops and returns canned rows."""

    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_kw):
        return self

    def eq(self, *_a, **_kw):
        return self

    def filter(self, *_a, **_kw):
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def maybe_single(self):
        return self

    def single(self):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _Supabase:
    def __init__(self, rows_by_table: dict[str, list | dict | None]):
        self._rows_by_table = rows_by_table

    def schema(self, _schema):
        return self

    def table(self, name):
        return _Chain(self._rows_by_table.get(name))


# ─── _resolve_core_user_id ─────────────────────────────────────────────────

def test_resolve_core_user_id_returns_id_when_row_present():
    sb = _Supabase({"users": {"id": "core-42"}})
    with patch.object(iris_tools, "supabase_client", sb):
        assert _resolve_core_user_id("auth-1") == "core-42"


def test_resolve_core_user_id_none_when_missing():
    sb = _Supabase({"users": None})
    with patch.object(iris_tools, "supabase_client", sb):
        assert _resolve_core_user_id("auth-1") is None


def test_resolve_core_user_id_none_on_empty_auth_id():
    sb = _Supabase({"users": {"id": "x"}})
    with patch.object(iris_tools, "supabase_client", sb):
        assert _resolve_core_user_id("") is None


def test_resolve_core_user_id_none_on_exception():
    class _Boom:
        def schema(self, _):
            raise RuntimeError("db down")

    with patch.object(iris_tools, "supabase_client", _Boom()):
        assert _resolve_core_user_id("auth-1") is None


# ─── _fetch_portfolio_sync ─────────────────────────────────────────────────

def test_fetch_portfolio_sync_returns_error_when_user_not_resolved():
    with patch.object(iris_tools, "_resolve_core_user_id", return_value=None):
        result = _fetch_portfolio_sync("auth-x")
    assert "error" in result
    assert "No trading account" in result["error"]


def test_fetch_portfolio_sync_formats_positions_and_trades():
    sb = _Supabase(
        {
            "users": {"id": "core-1"},
            "open_positions": [
                {
                    "symbol": "AAPL",
                    "quantity": 10,
                    "entry_price": 100,
                    "current_price": 110,
                    "type": "long",
                    "entry_date": "2026-01-01",
                },
            ],
            "trades": [
                {
                    "symbol": "NVDA",
                    "quantity": 5,
                    "entry_price": 200,
                    "exit_price": 220,
                    "pnl": 100,
                    "type": "long",
                    "exit_date": "2026-03-01",
                },
                {
                    "symbol": "TSLA",
                    "quantity": 2,
                    "entry_price": 300,
                    "exit_price": 250,
                    "pnl": -100,
                    "type": "short",
                    "exit_date": "2026-03-02",
                },
            ],
            "portfolio_history": [
                {"date": "2026-03-31", "value": 11000},
                {"date": "2026-03-01", "value": 10000},
            ],
        }
    )
    with patch.object(iris_tools, "supabase_client", sb):
        result = _fetch_portfolio_sync("auth-1")

    assert result["portfolio_value"] == 11000.0
    assert result["value_change_30d"] == 1000.0
    # Two trades with 1 winner → 50% win rate.
    assert result["win_rate"] == 50.0
    assert result["realized_pnl"] == 0.0
    assert result["total_open_positions"] == 1
    # Position formatting: +10% gain on AAPL
    assert any("AAPL" in line and "+10.0%" in line for line in result["open_positions"])


def test_fetch_portfolio_sync_handles_zero_entry_price_gracefully():
    sb = _Supabase(
        {
            "users": {"id": "core-1"},
            "open_positions": [{"symbol": "X", "entry_price": 0, "current_price": 10}],
            "trades": [],
            "portfolio_history": [],
        }
    )
    with patch.object(iris_tools, "supabase_client", sb):
        result = _fetch_portfolio_sync("auth-1")

    assert "+0.0%" in result["open_positions"][0]
    assert result["win_rate"] == 0.0


# ─── _fetch_top_stocks_sync ────────────────────────────────────────────────

def test_fetch_top_stocks_sync_returns_structured_response():
    sb = _Supabase(
        {
            "trending_stocks": [
                {
                    "ticker": "AAPL",
                    "name": "Apple",
                    "composite_score": 90,
                    "momentum_score": 85,
                    "trend_score": 70,
                    "volume_score": 40,
                    "adx_score": 30,
                    "rank_tier": "Strong Buy",
                    "conviction": "High",
                    "change_percent": 1.2,
                    "ranked_at": "2026-04-24T00:00:00Z",
                },
            ],
            "macro_snapshots": [
                {
                    "vix": 14.0,
                    "yield_10y": 4.2,
                    "sp500_level": 5000,
                    "sp500_change_pct": 0.5,
                    "fed_funds_rate": 3.0,
                },
            ],
        }
    )

    with patch.object(iris_tools, "supabase_client", sb):
        result = _fetch_top_stocks_sync(limit=5)

    assert result["ranked_at"] == "2026-04-24T00:00:00Z"
    assert result["macro_context"]["vix"] == 14.0
    assert len(result["top_stocks"]) == 1
    assert result["top_stocks"][0]["rank"] == 1
    assert "strong momentum" in result["top_stocks"][0]["why_top"]


def test_fetch_top_stocks_sync_returns_error_without_client():
    with patch.object(iris_tools, "supabase_client", None):
        assert _fetch_top_stocks_sync(limit=10) == {"error": "Supabase client not configured"}


# ─── Async wrappers ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_portfolio_data_wraps_sync_fetcher():
    expected = {"portfolio_value": 123}
    with patch.object(iris_tools, "_fetch_portfolio_sync", return_value=expected):
        result = await get_portfolio_data("auth-1")
    assert result == expected


@pytest.mark.asyncio
async def test_get_portfolio_data_returns_error_on_exception():
    with patch.object(iris_tools, "_fetch_portfolio_sync", side_effect=RuntimeError("x")):
        result = await get_portfolio_data("auth-1")
    assert "error" in result
    assert "Portfolio lookup failed" in result["error"]


@pytest.mark.asyncio
async def test_get_top_stocks_data_error_on_exception():
    with patch.object(iris_tools, "_fetch_top_stocks_sync", side_effect=RuntimeError("x")):
        result = await get_top_stocks_data(limit=5)
    assert "error" in result
    assert "Top stocks lookup failed" in result["error"]
