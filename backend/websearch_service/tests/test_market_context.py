"""Tests for app.services.market_context — Supabase-backed context builders."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services import market_context
from app.services.market_context import (
    _fetch_fundamentals_sync,
    _fetch_macro_sync,
    _fetch_price_history_sync,
    _fetch_trending_sync,
    _format_composite_score,
    _format_fundamentals,
    _format_macro,
    _format_price_history,
    build_market_context,
)


# ─── Formatter: macro ───────────────────────────────────────────────────────

def test_format_macro_includes_all_key_fields():
    row = {
        "date": "2026-04-20",
        "market_regime": "risk_on",
        "vix": 14.5,
        "sp500_level": 5100.25,
        "sp500_change_pct": 0.42,
        "yield_10y": 4.2,
        "yield_2y": 4.5,
        "yield_curve_spread": -0.3,
        "sector_leaders": "Tech, Financials",
        "sector_laggards": "Utilities",
    }
    result = _format_macro(row)

    assert "2026-04-20" in result
    assert "risk_on" in result
    assert "VIX: 14.5" in result
    # Negative spread must be flagged as inverted.
    assert "inverted" in result
    assert "Sector Leaders: Tech, Financials" in result


def test_format_macro_normal_curve_for_positive_spread():
    row = {"yield_curve_spread": 0.5}
    result = _format_macro(row)
    assert "normal" in result


def test_format_macro_handles_non_numeric_spread():
    # When spread is missing, curve label should be N/A instead of raising.
    result = _format_macro({})
    assert "N/A" in result


# ─── Formatter: price history ──────────────────────────────────────────────

def test_format_price_history_no_data_note_when_empty():
    result = _format_price_history("AAPL", [])
    assert "Data not yet available" in result
    assert "AAPL" in result


def test_format_price_history_computes_pct_change_and_signal_bullish():
    rows = [
        {
            "close": 110.0,
            "high_52w": 120.0,
            "low_52w": 80.0,
            "rsi_14": 55,
            "sma_50": 100.0,
            "sma_200": 90.0,
            "is_bullish": True,
        },
        {"close": 100.0},
    ]
    result = _format_price_history("AAPL", rows)

    assert "Change: +10.00%" in result
    # is_bullish=True AND close>sma_50 → Bullish
    assert "Signal: Bullish" in result


def test_format_price_history_signal_bearish_when_below_sma_200():
    rows = [
        {
            "close": 50.0,
            "sma_50": 70.0,
            "sma_200": 80.0,
            "is_bullish": False,
        },
        {"close": 60.0},
    ]
    result = _format_price_history("XYZ", rows)
    assert "Signal: Bearish" in result


def test_format_price_history_falls_back_to_is_bullish_flag_when_no_numerics():
    rows = [{"close": "N/A", "sma_50": None, "sma_200": None, "is_bullish": True}]
    result = _format_price_history("XYZ", rows)
    assert "Signal: Bullish" in result


def test_format_price_history_handles_zero_division():
    # Oldest close of 0 must not blow up.
    rows = [{"close": 10.0}, {"close": 0.0}]
    result = _format_price_history("X", rows)
    assert "N/A" in result


# ─── Formatter: fundamentals ───────────────────────────────────────────────

def test_format_fundamentals_empty_rows_returns_placeholder():
    result = _format_fundamentals("AAPL", [])
    assert "Data not yet available" in result


def test_format_fundamentals_includes_key_ratios():
    rows = [
        {
            "pe_ratio": 25.5,
            "forward_pe": 22.1,
            "peg_ratio": 1.2,
            "price_to_book": 4.3,
            "price_to_sales": 6.1,
            "eps_growth": 12.0,
            "revenue_growth": 8.5,
            "dividend_yield": 0.5,
            "market_cap": "2.5T",
        }
    ]
    result = _format_fundamentals("AAPL", rows)

    assert "P/E: 25.5" in result
    assert "PEG: 1.2" in result
    assert "Dividend Yield: 0.5" in result
    assert "2.5T" in result


def test_format_composite_score_includes_scoring_fields():
    row = {
        "composite_score": 87,
        "rank": 3,
        "momentum_score": 82,
        "technical_score": 75,
        "fundamental_score": 90,
        "conviction": "high",
        "signal": "BUY",
        "signal_confidence": 0.84,
    }
    result = _format_composite_score("AAPL", row)

    assert "Composite: 87/100" in result
    assert "Rank: #3" in result
    assert "Signal: BUY" in result


# ─── Fetchers: sync Supabase helpers ────────────────────────────────────────


def _fake_supabase(result_data):
    """Build a minimal Supabase test double that records method chains."""
    chain = SimpleNamespace()
    chain.select = lambda *a, **k: chain
    chain.eq = lambda *a, **k: chain
    chain.order = lambda *a, **k: chain
    chain.limit = lambda *a, **k: chain
    chain.execute = lambda: SimpleNamespace(data=result_data)

    table = SimpleNamespace(table=lambda name: chain)
    client = SimpleNamespace(schema=lambda name: table)
    return client


def test_fetch_macro_sync_returns_first_row():
    row = {"date": "2026-04-20", "market_regime": "risk_on"}
    with patch.object(market_context, "supabase_client", _fake_supabase([row])):
        assert _fetch_macro_sync() == row


def test_fetch_macro_sync_returns_none_when_no_rows():
    with patch.object(market_context, "supabase_client", _fake_supabase([])):
        assert _fetch_macro_sync() is None


def test_fetch_price_history_sync_returns_rows():
    rows = [{"ticker": "AAPL", "close": 100.0}]
    with patch.object(market_context, "supabase_client", _fake_supabase(rows)):
        assert _fetch_price_history_sync("AAPL") == rows


def test_fetch_fundamentals_sync_returns_rows():
    rows = [{"pe_ratio": 25}]
    with patch.object(market_context, "supabase_client", _fake_supabase(rows)):
        assert _fetch_fundamentals_sync("AAPL") == rows


def test_fetch_trending_sync_returns_first_row_or_none():
    row = {"ticker": "AAPL", "composite_score": 91}
    with patch.object(market_context, "supabase_client", _fake_supabase([row])):
        assert _fetch_trending_sync("AAPL") == row
    with patch.object(market_context, "supabase_client", _fake_supabase([])):
        assert _fetch_trending_sync("AAPL") is None


# ─── Public API: build_market_context ──────────────────────────────────────

@pytest.mark.asyncio
async def test_build_market_context_macro_only_when_no_ticker():
    macro_row = {"date": "2026-04-20", "market_regime": "risk_on"}
    with patch.object(market_context, "_fetch_macro_sync", return_value=macro_row):
        result = await build_market_context()

    assert "MACRO CONTEXT" in result
    assert "PRICE HISTORY" not in result


@pytest.mark.asyncio
async def test_build_market_context_with_ticker_includes_all_sections():
    macro_row = {"date": "2026-04-20", "market_regime": "risk_on"}
    price_rows = [{"close": 100.0, "is_bullish": True, "sma_50": 90, "sma_200": 80}, {"close": 90.0}]
    fund_rows = [{"pe_ratio": 25}]
    trending_row = {"composite_score": 91, "rank": 1, "signal": "BUY"}

    with patch.object(market_context, "_fetch_macro_sync", return_value=macro_row), \
         patch.object(market_context, "_fetch_price_history_sync", return_value=price_rows), \
         patch.object(market_context, "_fetch_fundamentals_sync", return_value=fund_rows), \
         patch.object(market_context, "_fetch_trending_sync", return_value=trending_row):
        result = await build_market_context(ticker="AAPL")

    assert "MACRO CONTEXT" in result
    assert "PRICE HISTORY: AAPL" in result
    assert "FUNDAMENTALS: AAPL" in result
    assert "THE EYE SCORE: AAPL" in result


@pytest.mark.asyncio
async def test_build_market_context_emits_unified_message_when_ticker_has_no_data():
    macro_row = {"date": "2026-04-20"}

    with patch.object(market_context, "_fetch_macro_sync", return_value=macro_row), \
         patch.object(market_context, "_fetch_price_history_sync", return_value=[]), \
         patch.object(market_context, "_fetch_fundamentals_sync", return_value=[]), \
         patch.object(market_context, "_fetch_trending_sync", return_value=None):
        result = await build_market_context(ticker="ZZZ")

    assert "No market data available for ZZZ" in result


@pytest.mark.asyncio
async def test_build_market_context_degrades_gracefully_on_macro_error():
    with patch.object(market_context, "_fetch_macro_sync", side_effect=RuntimeError("db down")):
        result = await build_market_context()

    # Must always return something, never raise.
    assert "MACRO CONTEXT" in result
    assert "Data not yet available" in result


@pytest.mark.asyncio
async def test_build_market_context_degrades_gracefully_on_ticker_errors():
    with patch.object(market_context, "_fetch_macro_sync", return_value={"date": "2026-04-20"}), \
         patch.object(market_context, "_fetch_price_history_sync", side_effect=RuntimeError("x")), \
         patch.object(market_context, "_fetch_fundamentals_sync", side_effect=RuntimeError("y")), \
         patch.object(market_context, "_fetch_trending_sync", side_effect=RuntimeError("z")):
        result = await build_market_context(ticker="AAPL")

    # Errors on every ticker-specific block collapse into the no-data summary.
    assert "No market data available for AAPL" in result
