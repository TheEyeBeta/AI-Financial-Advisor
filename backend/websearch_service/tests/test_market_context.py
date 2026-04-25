"""Tests for market_context.py — formatters and async build_market_context."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from app.services.market_context import (
    _format_macro,
    _format_price_history,
    _format_fundamentals,
    _format_composite_score,
    _table,
    build_market_context,
)


# ── _table helper ──────────────────────────────────────────────────────────────

class TestTableHelper:
    def test_uses_schema_when_available(self):
        client = MagicMock()
        client.schema.return_value.table.return_value = "schema_table"
        result = _table(client, "market", "trending_stocks")
        client.schema.assert_called_once_with("market")
        client.schema.return_value.table.assert_called_once_with("trending_stocks")
        assert result == "schema_table"

    def test_falls_back_to_table_when_no_schema(self):
        client = MagicMock(spec=[])  # no 'schema' attribute
        client.table = MagicMock(return_value="direct_table")
        result = _table(client, "market", "trending_stocks")
        client.table.assert_called_once_with("trending_stocks")
        assert result == "direct_table"


# ── _format_macro ──────────────────────────────────────────────────────────────

class TestFormatMacro:
    def _row(self, **kwargs):
        base = {
            "date": "2026-04-24",
            "market_regime": "Bull",
            "vix": 18.5,
            "sp500_level": 5200.0,
            "sp500_change_pct": 0.5,
            "yield_10y": 4.3,
            "yield_2y": 4.8,
            "yield_curve_spread": -0.5,
            "sector_leaders": "Tech, Energy",
            "sector_laggards": "Utilities",
        }
        base.update(kwargs)
        return base

    def test_basic_output(self):
        result = _format_macro(self._row())
        assert "MACRO CONTEXT" in result
        assert "Bull" in result
        assert "18.5" in result
        assert "5200.0" in result

    def test_inverted_yield_curve(self):
        result = _format_macro(self._row(yield_curve_spread=-0.5))
        assert "inverted" in result

    def test_normal_yield_curve(self):
        result = _format_macro(self._row(yield_curve_spread=0.3))
        assert "normal" in result

    def test_non_numeric_spread_label(self):
        result = _format_macro(self._row(yield_curve_spread="N/A"))
        assert "N/A" in result

    def test_missing_fields_show_na(self):
        result = _format_macro({})
        assert "N/A" in result

    def test_date_in_header(self):
        result = _format_macro(self._row(date="2026-01-01"))
        assert "2026-01-01" in result

    def test_sector_leaders_present(self):
        result = _format_macro(self._row(sector_leaders="Tech"))
        assert "Tech" in result

    def test_spread_zero_is_normal(self):
        result = _format_macro(self._row(yield_curve_spread=0))
        assert "normal" in result


# ── _format_price_history ──────────────────────────────────────────────────────

class TestFormatPriceHistory:
    def _row(self, close=150.0, **kwargs):
        base = {
            "close": close,
            "high_52w": 180.0,
            "low_52w": 120.0,
            "rsi_14": 55.0,
            "sma_50": 145.0,
            "sma_200": 140.0,
            "is_bullish": True,
        }
        base.update(kwargs)
        return base

    def test_empty_rows_returns_unavailable(self):
        result = _format_price_history("AAPL", [])
        assert "Data not yet available" in result
        assert "AAPL" in result

    def test_basic_output(self):
        rows = [self._row(close=150.0), self._row(close=130.0)]
        result = _format_price_history("AAPL", rows)
        assert "AAPL" in result
        assert "150.0" in result
        assert "130.0" in result

    def test_pct_change_calculation(self):
        rows = [self._row(close=110.0), self._row(close=100.0)]
        result = _format_price_history("AAPL", rows)
        assert "+10.00" in result

    def test_bullish_signal(self):
        # is_bullish=True and close > sma_50
        rows = [self._row(close=150.0, sma_50=140.0, is_bullish=True)]
        result = _format_price_history("AAPL", rows)
        assert "Bullish" in result

    def test_bearish_signal_below_sma200(self):
        rows = [self._row(close=130.0, sma_50=145.0, sma_200=140.0, is_bullish=False)]
        result = _format_price_history("AAPL", rows)
        assert "Bearish" in result

    def test_neutral_signal(self):
        rows = [self._row(close=142.0, sma_50=145.0, sma_200=140.0, is_bullish=False)]
        result = _format_price_history("AAPL", rows)
        assert "Neutral" in result

    def test_non_numeric_close_graceful(self):
        rows = [self._row(close=None), self._row(close=None)]
        result = _format_price_history("AAPL", rows)
        assert "AAPL" in result  # doesn't crash

    def test_zero_oldest_close_no_divzero(self):
        rows = [self._row(close=100.0), self._row(close=0.0)]
        result = _format_price_history("AAPL", rows)
        assert "AAPL" in result

    def test_is_bullish_flag_true_below_sma50_neutral(self):
        # is_bullish True but close < sma_50 → Neutral (not Bullish, not Bearish by SMA200)
        rows = [self._row(close=138.0, sma_50=145.0, sma_200=130.0, is_bullish=True)]
        result = _format_price_history("AAPL", rows)
        assert "Neutral" in result

    def test_is_bullish_none_is_bullish_exception_path(self):
        rows = [{"close": "bad", "sma_50": "bad", "sma_200": "bad", "is_bullish": True}]
        result = _format_price_history("AAPL", rows)
        assert "Bullish" in result

    def test_is_bullish_false_exception_path(self):
        rows = [{"close": "bad", "sma_50": "bad", "sma_200": "bad", "is_bullish": False}]
        result = _format_price_history("AAPL", rows)
        assert "Bearish" in result

    def test_is_bullish_none_exception_path(self):
        rows = [{"close": "bad", "sma_50": "bad", "sma_200": "bad", "is_bullish": None}]
        result = _format_price_history("AAPL", rows)
        assert "Neutral" in result


# ── _format_fundamentals ───────────────────────────────────────────────────────

class TestFormatFundamentals:
    def _row(self, **kwargs):
        base = {
            "pe_ratio": 25.0,
            "forward_pe": 22.0,
            "peg_ratio": 1.5,
            "price_to_book": 3.0,
            "price_to_sales": 2.5,
            "eps_growth": 15.0,
            "revenue_growth": 12.0,
            "dividend_yield": 0.5,
            "market_cap": 2500000000000,
        }
        base.update(kwargs)
        return base

    def test_empty_rows_returns_unavailable(self):
        result = _format_fundamentals("AAPL", [])
        assert "Data not yet available" in result
        assert "AAPL" in result

    def test_basic_output(self):
        result = _format_fundamentals("AAPL", [self._row()])
        assert "AAPL" in result
        assert "25.0" in result
        assert "FUNDAMENTALS" in result

    def test_uses_first_row_only(self):
        rows = [self._row(pe_ratio=25.0), self._row(pe_ratio=999.0)]
        result = _format_fundamentals("AAPL", rows)
        assert "25.0" in result
        assert "999.0" not in result

    def test_missing_fields_show_na(self):
        result = _format_fundamentals("AAPL", [{}])
        assert "N/A" in result

    def test_eps_growth_present(self):
        result = _format_fundamentals("AAPL", [self._row(eps_growth=20.0)])
        assert "20.0" in result


# ── _format_composite_score ────────────────────────────────────────────────────

class TestFormatCompositeScore:
    def _row(self, **kwargs):
        base = {
            "composite_score": 82.5,
            "rank": 3,
            "momentum_score": 78.0,
            "technical_score": 85.0,
            "fundamental_score": 70.0,
            "conviction": "High",
            "signal": "Buy",
            "signal_confidence": 0.9,
        }
        base.update(kwargs)
        return base

    def test_basic_output(self):
        result = _format_composite_score("AAPL", self._row())
        assert "THE EYE SCORE" in result
        assert "AAPL" in result
        assert "82.5" in result
        assert "#3" in result

    def test_missing_fields_show_na(self):
        result = _format_composite_score("AAPL", {})
        assert "N/A" in result

    def test_conviction_present(self):
        result = _format_composite_score("AAPL", self._row(conviction="Low"))
        assert "Low" in result

    def test_signal_present(self):
        result = _format_composite_score("AAPL", self._row(signal="Sell"))
        assert "Sell" in result


# ── build_market_context (async) ───────────────────────────────────────────────

class TestBuildMarketContext:
    def _fake_macro(self):
        return {
            "date": "2026-04-24",
            "market_regime": "Bull",
            "vix": 18.5,
            "sp500_level": 5200.0,
            "sp500_change_pct": 0.5,
            "yield_10y": 4.3,
            "yield_2y": 4.8,
            "yield_curve_spread": -0.5,
            "sector_leaders": "Tech",
            "sector_laggards": "Utils",
        }

    def _fake_price_row(self):
        return {
            "close": 150.0,
            "high_52w": 180.0,
            "low_52w": 120.0,
            "rsi_14": 55.0,
            "sma_50": 145.0,
            "sma_200": 140.0,
            "is_bullish": True,
        }

    def _fake_fund_row(self):
        return {
            "pe_ratio": 25.0, "forward_pe": 22.0, "peg_ratio": 1.5,
            "price_to_book": 3.0, "price_to_sales": 2.5,
            "eps_growth": 15.0, "revenue_growth": 12.0,
            "dividend_yield": 0.5, "market_cap": 2_500_000_000_000,
        }

    def test_no_ticker_macro_only(self):
        with patch(
            "app.services.market_context._fetch_macro_sync",
            return_value=self._fake_macro(),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context()
            )
        assert "MACRO CONTEXT" in result
        assert "Bull" in result

    def test_no_macro_data_returns_unavailable(self):
        with patch("app.services.market_context._fetch_macro_sync", return_value=None):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context()
            )
        assert "Data not yet available" in result

    def test_macro_fetch_exception_graceful(self):
        with patch(
            "app.services.market_context._fetch_macro_sync",
            side_effect=Exception("DB error"),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context()
            )
        assert "Data not yet available" in result
        assert result  # non-empty

    def test_with_ticker_includes_price_and_fundamentals(self):
        with patch("app.services.market_context._fetch_macro_sync", return_value=self._fake_macro()), \
             patch("app.services.market_context._fetch_price_history_sync", return_value=[self._fake_price_row()]), \
             patch("app.services.market_context._fetch_fundamentals_sync", return_value=[self._fake_fund_row()]), \
             patch("app.services.market_context._fetch_trending_sync", return_value=None):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context(ticker="AAPL")
            )
        assert "PRICE HISTORY" in result
        assert "FUNDAMENTALS" in result
        assert "AAPL" in result

    def test_with_ticker_includes_composite_score_when_present(self):
        trending = {
            "composite_score": 82.5, "rank": 3, "momentum_score": 78.0,
            "technical_score": 85.0, "fundamental_score": 70.0,
            "conviction": "High", "signal": "Buy", "signal_confidence": 0.9,
        }
        with patch("app.services.market_context._fetch_macro_sync", return_value=self._fake_macro()), \
             patch("app.services.market_context._fetch_price_history_sync", return_value=[self._fake_price_row()]), \
             patch("app.services.market_context._fetch_fundamentals_sync", return_value=[self._fake_fund_row()]), \
             patch("app.services.market_context._fetch_trending_sync", return_value=trending):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context(ticker="AAPL")
            )
        assert "THE EYE SCORE" in result

    def test_all_ticker_data_unavailable_shows_fallback(self):
        with patch("app.services.market_context._fetch_macro_sync", return_value=self._fake_macro()), \
             patch("app.services.market_context._fetch_price_history_sync", return_value=[]), \
             patch("app.services.market_context._fetch_fundamentals_sync", return_value=[]), \
             patch("app.services.market_context._fetch_trending_sync", return_value=None):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context(ticker="XYZ")
            )
        assert "No market data available for XYZ" in result

    def test_price_history_exception_graceful(self):
        with patch("app.services.market_context._fetch_macro_sync", return_value=self._fake_macro()), \
             patch("app.services.market_context._fetch_price_history_sync", side_effect=Exception("err")), \
             patch("app.services.market_context._fetch_fundamentals_sync", return_value=[]), \
             patch("app.services.market_context._fetch_trending_sync", return_value=None):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context(ticker="AAPL")
            )
        assert "AAPL" in result

    def test_fundamentals_exception_graceful(self):
        with patch("app.services.market_context._fetch_macro_sync", return_value=self._fake_macro()), \
             patch("app.services.market_context._fetch_price_history_sync", return_value=[self._fake_price_row()]), \
             patch("app.services.market_context._fetch_fundamentals_sync", side_effect=Exception("err")), \
             patch("app.services.market_context._fetch_trending_sync", return_value=None):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context(ticker="AAPL")
            )
        assert "AAPL" in result

    def test_trending_exception_graceful(self):
        with patch("app.services.market_context._fetch_macro_sync", return_value=self._fake_macro()), \
             patch("app.services.market_context._fetch_price_history_sync", return_value=[self._fake_price_row()]), \
             patch("app.services.market_context._fetch_fundamentals_sync", return_value=[self._fake_fund_row()]), \
             patch("app.services.market_context._fetch_trending_sync", side_effect=Exception("err")):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context(ticker="AAPL")
            )
        assert "AAPL" in result

    def test_result_always_nonempty(self):
        with patch("app.services.market_context._fetch_macro_sync", return_value=None):
            result = asyncio.get_event_loop().run_until_complete(
                build_market_context()
            )
        assert result.strip()
