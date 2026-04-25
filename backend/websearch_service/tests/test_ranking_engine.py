"""Tests for ranking_engine.py — pure math helpers and cycle logic."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.services.ranking_engine import (
    _f,
    _winsorize,
    _minmax_normalize,
    _has_complete_data,
    _rank_tier,
    _conviction,
    _run_ranking_cycle_sync,
    _persist_ranking_history,
    run_ranking_cycle,
)


# ── _f (safe float) ────────────────────────────────────────────────────────────

class TestF:
    def test_none_returns_none(self):
        assert _f(None) is None

    def test_int(self):
        assert _f(5) == 5.0

    def test_float(self):
        assert _f(3.14) == pytest.approx(3.14)

    def test_string_number(self):
        assert _f("42.5") == pytest.approx(42.5)

    def test_invalid_string_returns_none(self):
        assert _f("abc") is None

    def test_inf_returns_none(self):
        assert _f(float("inf")) is None

    def test_neg_inf_returns_none(self):
        assert _f(float("-inf")) is None

    def test_nan_returns_none(self):
        assert _f(float("nan")) is None

    def test_zero(self):
        assert _f(0) == 0.0

    def test_negative(self):
        assert _f(-10.5) == pytest.approx(-10.5)


# ── _winsorize ─────────────────────────────────────────────────────────────────

class TestWinsorize:
    def test_too_few_values_returned_unchanged(self):
        vals = {"A": 1.0, "B": 2.0, "C": 100.0}
        result = _winsorize(vals)
        assert result == vals

    def test_clips_outliers(self):
        vals = {str(i): float(i) for i in range(1, 11)}  # 1–10
        result = _winsorize(vals, lower_pct=10, upper_pct=90)
        # All values should be clipped to [p10, p90] range
        lo = min(result.values())
        hi = max(result.values())
        assert lo >= 1.0
        assert hi <= 10.0

    def test_returns_dict_with_same_keys(self):
        vals = {"X": 1.0, "Y": 5.0, "Z": 100.0, "W": 50.0, "V": 25.0}
        result = _winsorize(vals)
        assert set(result.keys()) == set(vals.keys())

    def test_exactly_four_values_processed(self):
        vals = {"A": 1.0, "B": 50.0, "C": 99.0, "D": 100.0}
        result = _winsorize(vals)
        assert len(result) == 4


# ── _minmax_normalize ──────────────────────────────────────────────────────────

class TestMinmaxNormalize:
    def test_empty_returns_empty(self):
        assert _minmax_normalize({}) == {}

    def test_single_value_returns_default(self):
        result = _minmax_normalize({"A": 42.0})
        assert result["A"] == 50.0

    def test_all_equal_returns_default(self):
        result = _minmax_normalize({"A": 5.0, "B": 5.0, "C": 5.0})
        for v in result.values():
            assert v == 50.0

    def test_range_maps_to_0_100(self):
        result = _minmax_normalize({"lo": 0.0, "hi": 100.0})
        # After winsorize (only 2 keys < 4, so no clip), min→0, max→100
        assert result["hi"] >= result["lo"]

    def test_five_values_spread(self):
        vals = {"a": 0.0, "b": 25.0, "c": 50.0, "d": 75.0, "e": 100.0}
        result = _minmax_normalize(vals)
        # Highest gets ~100, lowest gets ~0
        assert result["e"] > result["a"]
        for v in result.values():
            assert 0.0 <= v <= 100.0

    def test_custom_default(self):
        result = _minmax_normalize({"X": 5.0, "Y": 5.0}, default=42.0)
        assert result["X"] == 42.0

    def test_output_rounded_to_2dp(self):
        vals = {str(i): float(i) for i in range(6)}
        result = _minmax_normalize(vals)
        for v in result.values():
            assert round(v, 2) == v


# ── _rank_tier ─────────────────────────────────────────────────────────────────

class TestRankTier:
    def test_strong_buy(self):
        assert _rank_tier(80.0) == "Strong Buy"
        assert _rank_tier(95.0) == "Strong Buy"

    def test_buy(self):
        assert _rank_tier(65.0) == "Buy"
        assert _rank_tier(79.9) == "Buy"

    def test_hold(self):
        assert _rank_tier(45.0) == "Hold"
        assert _rank_tier(64.9) == "Hold"

    def test_underperform(self):
        assert _rank_tier(30.0) == "Underperform"
        assert _rank_tier(44.9) == "Underperform"

    def test_sell(self):
        assert _rank_tier(0.0) == "Sell"
        assert _rank_tier(29.9) == "Sell"

    def test_boundary_80(self):
        assert _rank_tier(80.0) == "Strong Buy"

    def test_boundary_65(self):
        assert _rank_tier(65.0) == "Buy"

    def test_boundary_45(self):
        assert _rank_tier(45.0) == "Hold"

    def test_boundary_30(self):
        assert _rank_tier(30.0) == "Underperform"


# ── _conviction ────────────────────────────────────────────────────────────────

class TestConviction:
    def test_high(self):
        assert _conviction(70.0) == "High"
        assert _conviction(100.0) == "High"

    def test_medium(self):
        assert _conviction(50.0) == "Medium"
        assert _conviction(69.9) == "Medium"

    def test_low(self):
        assert _conviction(0.0) == "Low"
        assert _conviction(49.9) == "Low"

    def test_boundary_70(self):
        assert _conviction(70.0) == "High"

    def test_boundary_50(self):
        assert _conviction(50.0) == "Medium"


# ── _has_complete_data ─────────────────────────────────────────────────────────

class TestHasCompleteData:
    def _good_snap(self):
        return {
            "price_vs_sma_50": 1.05,
            "rsi_14": 55.0,
            "macd_histogram": 0.2,
            "volume": 1_000_000,
            "last_price": 150.0,
            "adx": 25.0,
        }

    def _good_returns(self):
        return {
            "has_6m_history": True,
            "return_6m": 0.12,
            "return_3m": 0.06,
            "return_1m": 0.02,
            "return_12m": 0.20,
        }

    def test_complete_data_returns_true(self):
        assert _has_complete_data(self._good_snap(), self._good_returns()) is True

    def test_no_returns_row_returns_false(self):
        assert _has_complete_data(self._good_snap(), None) is False

    def test_no_6m_history_returns_false(self):
        ret = self._good_returns()
        ret["has_6m_history"] = False
        assert _has_complete_data(self._good_snap(), ret) is False

    def test_missing_return_6m_returns_false(self):
        ret = self._good_returns()
        ret["return_6m"] = None
        assert _has_complete_data(self._good_snap(), ret) is False

    def test_missing_return_3m_returns_false(self):
        ret = self._good_returns()
        ret["return_3m"] = None
        assert _has_complete_data(self._good_snap(), ret) is False

    def test_missing_snapshot_field_returns_false(self):
        snap = self._good_snap()
        del snap["adx"]
        assert _has_complete_data(snap, self._good_returns()) is False

    def test_null_snapshot_field_returns_false(self):
        snap = self._good_snap()
        snap["rsi_14"] = None
        assert _has_complete_data(snap, self._good_returns()) is False

    def test_non_finite_snapshot_field_returns_false(self):
        snap = self._good_snap()
        snap["last_price"] = float("inf")
        assert _has_complete_data(snap, self._good_returns()) is False


# ── _run_ranking_cycle_sync ────────────────────────────────────────────────────

def _make_mock_client(snap_rows=None, returns_rows=None):
    """Build a mock supabase_client for ranking tests."""
    mock_client = MagicMock()

    def schema_side_effect(schema_name):
        schema_mock = MagicMock()

        def table_side_effect(table_name):
            tbl = MagicMock()
            chain = MagicMock()
            chain.execute.return_value = MagicMock(data=[])
            tbl.select.return_value = chain
            chain.order.return_value = chain
            chain.limit.return_value = chain
            chain.eq.return_value = chain
            chain.filter.return_value = chain
            chain.upsert.return_value = chain
            chain.delete.return_value = chain
            chain.insert.return_value = chain
            chain.not_.is_.return_value = chain

            if schema_name == "market" and table_name == "stock_snapshots":
                result_mock = MagicMock()
                result_mock.data = snap_rows or []
                chain.execute.return_value = result_mock
            elif schema_name == "market" and table_name == "stock_returns_mv":
                result_mock = MagicMock()
                result_mock.data = returns_rows or []
                chain.execute.return_value = result_mock

            return tbl

        schema_mock.table = MagicMock(side_effect=table_side_effect)
        return schema_mock

    mock_client.schema = MagicMock(side_effect=schema_side_effect)
    return mock_client


class TestRunRankingCycleSync:
    def _good_snap(self, ticker="AAPL", **kwargs):
        base = {
            "ticker": ticker,
            "company_name": f"{ticker} Inc",
            "price_vs_sma_50": 1.05,
            "rsi_14": 55.0,
            "macd_histogram": 0.2,
            "volume": 1_000_000,
            "avg_volume_10d": 900_000,
            "last_price": 150.0,
            "adx": 30.0,
            "is_bullish": True,
            "is_overbought": False,
            "is_oversold": False,
            "eps_growth": 15.0,
            "revenue_growth": 12.0,
            "pe_ratio": 25.0,
            "price_change_pct": 0.5,
        }
        base.update(kwargs)
        return base

    def _good_returns(self, ticker="AAPL"):
        return {
            "ticker": ticker,
            "has_6m_history": True,
            "return_6m": 0.15,
            "return_3m": 0.08,
            "return_1m": 0.03,
            "return_12m": 0.22,
            "total_trading_days": 130,
        }

    def test_no_filtered_tickers_returns_zero_scored(self):
        mock_client = _make_mock_client(snap_rows=[], returns_rows=[])
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            cycle_start = datetime.now(timezone.utc)
            result = _run_ranking_cycle_sync(cycle_start)
        assert result["tickers_scored"] == 0
        assert result["top_50_written"] == 0

    def test_single_ticker_scored(self):
        snap = self._good_snap("AAPL")
        ret = self._good_returns("AAPL")
        mock_client = _make_mock_client(snap_rows=[snap], returns_rows=[ret])
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            cycle_start = datetime.now(timezone.utc)
            result = _run_ranking_cycle_sync(cycle_start)
        assert result["tickers_scored"] == 1
        assert result["top_50_written"] == 1

    def test_adx_below_20_excluded(self):
        snap = self._good_snap("WEAK", adx=15.0)
        ret = self._good_returns("WEAK")
        mock_client = _make_mock_client(snap_rows=[snap], returns_rows=[ret])
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            cycle_start = datetime.now(timezone.utc)
            result = _run_ranking_cycle_sync(cycle_start)
        assert result["tickers_scored"] == 0
        # skipped_hard_filter only present in the full return (not the early-exit path)
        assert result.get("skipped_hard_filter", 1) == 1

    def test_incomplete_data_excluded(self):
        snap = self._good_snap("BAD", rsi_14=None)
        ret = self._good_returns("BAD")
        mock_client = _make_mock_client(snap_rows=[snap], returns_rows=[ret])
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            cycle_start = datetime.now(timezone.utc)
            result = _run_ranking_cycle_sync(cycle_start)
        assert result["tickers_scored"] == 0
        assert result.get("skipped_incomplete", 1) == 1

    def test_multiple_tickers_top_50_capped(self):
        snaps = [self._good_snap(f"T{i:03d}", adx=30.0 + i) for i in range(60)]
        rets = [self._good_returns(f"T{i:03d}") for i in range(60)]
        mock_client = _make_mock_client(snap_rows=snaps, returns_rows=rets)
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            cycle_start = datetime.now(timezone.utc)
            result = _run_ranking_cycle_sync(cycle_start)
        assert result["top_50_written"] == 50
        assert result["tickers_scored"] == 60

    def test_result_has_expected_keys(self):
        mock_client = _make_mock_client()
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            cycle_start = datetime.now(timezone.utc)
            result = _run_ranking_cycle_sync(cycle_start)
        assert "tickers_scored" in result
        assert "tickers_failed" in result
        assert "top_50_written" in result
        assert "cycle_duration_seconds" in result
        assert "ranked_at" in result

    def test_non_bullish_ticker_gets_neutral_adx_score(self):
        snap = self._good_snap("BEAR", is_bullish=False)
        ret = self._good_returns("BEAR")
        mock_client = _make_mock_client(snap_rows=[snap], returns_rows=[ret])
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            cycle_start = datetime.now(timezone.utc)
            result = _run_ranking_cycle_sync(cycle_start)
        # Should still score (not excluded for non-bullish)
        assert result["tickers_scored"] == 1


# ── _persist_ranking_history ───────────────────────────────────────────────────

class TestPersistRankingHistory:
    def test_empty_results_is_noop(self):
        mock_client = MagicMock()
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            _persist_ranking_history([], datetime.now(timezone.utc))
        mock_client.schema.assert_not_called()

    def test_writes_rows(self):
        results = [{
            "ticker": "AAPL",
            "composite_score": 75.0,
            "rank_tier": "Buy",
            "conviction": "High",
            "momentum_score": 70.0,
            "trend_score": 80.0,
            "volume_score": 60.0,
            "adx_score": 55.0,
            "quality_score": 65.0,
        }]
        mock_client = MagicMock()
        chain = MagicMock()
        mock_client.schema.return_value.table.return_value.insert.return_value = chain
        chain.execute.return_value = MagicMock(data=[])
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            _persist_ranking_history(results, datetime.now(timezone.utc))
        mock_client.schema.return_value.table.return_value.insert.assert_called_once()

    def test_insert_exception_does_not_raise(self):
        results = [{"ticker": "AAPL", "composite_score": 75.0,
                    "rank_tier": "Buy", "conviction": "High",
                    "momentum_score": 70.0, "trend_score": 80.0,
                    "volume_score": 60.0}]
        mock_client = MagicMock()
        mock_client.schema.return_value.table.return_value.insert.side_effect = Exception("DB down")
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            # Should not raise
            _persist_ranking_history(results, datetime.now(timezone.utc))


# ── run_ranking_cycle (async + lock) ──────────────────────────────────────────

class TestRunRankingCycle:
    def test_skips_when_already_running(self):
        import app.services.ranking_engine as eng
        eng._cycle_running = True
        try:
            result = asyncio.get_event_loop().run_until_complete(run_ranking_cycle())
            assert result == {"skipped": True}
        finally:
            eng._cycle_running = False

    def test_runs_cycle_and_resets_lock(self):
        import app.services.ranking_engine as eng
        mock_client = _make_mock_client()
        with patch("app.services.ranking_engine.supabase_client", mock_client):
            result = asyncio.get_event_loop().run_until_complete(run_ranking_cycle())
        assert "tickers_scored" in result
        assert eng._cycle_running is False
