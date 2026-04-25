"""Tests for stock_ranking route handlers."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.stock_ranking import router as ranking_router


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(ranking_router)
    return app


def _mock_rate_limiter(allowed: bool = True, error: str | None = None) -> MagicMock:
    limiter = MagicMock()
    limiter.check_rate_limit.return_value = (allowed, error or "Rate limit exceeded" if not allowed else None, {
        "limit_minute": 60, "remaining_minute": 59,
        "limit_hour": 3600, "remaining_hour": 3599,
        "limit_day": 86400, "remaining_day": 86399,
        "reset_minute": 9999999, "reset_hour": 9999999, "reset_day": 9999999,
    })
    limiter.add_rate_limit_headers.return_value = None
    limiter.release_request.return_value = None
    return limiter


def _make_chain(rows: list, raise_exc: bool = False) -> MagicMock:
    result = MagicMock()
    result.data = rows
    chain = MagicMock()
    if raise_exc:
        chain.execute.side_effect = Exception("DB error")
    else:
        chain.execute.return_value = result
    chain.select.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.eq.return_value = chain
    chain.gte.return_value = chain
    chain.not_.return_value = chain
    return chain


def _sb_mock(tables: dict[str, list | Exception]) -> MagicMock:
    """Build a supabase_client mock routing .table(name) to per-table data."""
    mock = MagicMock()

    def _table_side(table_name: str):
        data = tables.get(table_name, [])
        if isinstance(data, Exception):
            return _make_chain([], raise_exc=True)
        return _make_chain(data)

    schema = MagicMock()
    schema.table.side_effect = _table_side
    mock.schema.return_value = schema
    return mock


# ── GET /api/stocks/ranking ────────────────────────────────────────────────────

class TestGetStockRanking:
    def test_returns_empty_when_no_rows(self):
        mock_sb = _sb_mock({"trending_stocks": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/ranking")
        assert resp.status_code == 200
        data = resp.json()
        assert data["stocks"] == []
        assert data["total"] == 0

    def test_returns_stocks_from_db(self):
        rows = [
            {"ticker": "AAPL", "composite_score": 85.0, "ranked_at": "2026-04-25T01:00:00+00:00"},
            {"ticker": "MSFT", "composite_score": 80.0, "ranked_at": "2026-04-25T01:00:00+00:00"},
        ]
        mock_sb = _sb_mock({"trending_stocks": rows})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/ranking")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["stocks"]) == 2
        assert data["total"] == 2
        assert data["stocks"][0]["ticker"] == "AAPL"

    def test_data_age_computed(self):
        rows = [{"ticker": "AAPL", "composite_score": 75.0, "ranked_at": "2026-04-25T01:00:00+00:00"}]
        mock_sb = _sb_mock({"trending_stocks": rows})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/ranking")
        assert resp.status_code == 200
        data = resp.json()
        assert data["last_ranked_at"] == "2026-04-25T01:00:00+00:00"
        assert data["data_age_hours"] is not None

    def test_rate_limited_returns_429(self):
        mock_sb = _sb_mock({"trending_stocks": []})
        mock_rl = _mock_rate_limiter(allowed=False, error="Rate limit exceeded: 10 per minute")
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app(), raise_server_exceptions=False)
            resp = client.get("/api/stocks/ranking")
        assert resp.status_code == 429

    def test_supabase_error_returns_502(self):
        mock_sb = MagicMock()
        schema = MagicMock()
        chain = _make_chain([], raise_exc=True)
        schema.table.return_value = chain
        mock_sb.schema.return_value = schema
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app(), raise_server_exceptions=False)
            resp = client.get("/api/stocks/ranking")
        assert resp.status_code == 502

    def test_limit_param_slices_results(self):
        rows = [{"ticker": f"T{i}", "composite_score": float(100 - i), "ranked_at": None}
                for i in range(10)]
        mock_sb = _sb_mock({"trending_stocks": rows})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/ranking?limit=3")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["stocks"]) == 3
        assert data["total"] == 10

    def test_ranked_at_none_no_data_age(self):
        rows = [{"ticker": "AAPL", "composite_score": 75.0, "ranked_at": None}]
        mock_sb = _sb_mock({"trending_stocks": rows})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/ranking")
        assert resp.status_code == 200
        assert resp.json()["data_age_hours"] is None

    def test_ranked_at_invalid_str_no_error(self):
        rows = [{"ticker": "AAPL", "composite_score": 75.0, "ranked_at": "not-a-date"}]
        mock_sb = _sb_mock({"trending_stocks": rows})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/ranking")
        assert resp.status_code == 200
        assert resp.json()["data_age_hours"] is None


# ── GET /api/stocks/detail/{ticker} ───────────────────────────────────────────

def _snap_row(**overrides) -> dict:
    defaults = {
        "ticker": "AAPL",
        "company_name": "Apple Inc.",
        "last_price": 200.0,
        "price_change_pct": 1.5,
        "high_52w": 250.0,
        "low_52w": 150.0,
        "volume": 100000,
        "avg_volume_10d": 90000.0,
        "volume_ratio": 1.1,
        "price_vs_sma_50": 5.0,
        "price_vs_sma_200": 10.0,
        "rsi_14": 55.0,
        "rsi_9": 58.0,
        "macd": 2.5,
        "macd_signal": 2.0,
        "macd_histogram": 0.5,
        "adx": 30.0,
        "stochastic_k": 65.0,
        "stochastic_d": 60.0,
        "williams_r": -35.0,
        "cci": 120.0,
        "bollinger_upper": 220.0,
        "bollinger_lower": 180.0,
        "sma_50": 195.0,
        "sma_200": 185.0,
        "pe_ratio": 28.0,
        "forward_pe": 25.0,
        "peg_ratio": 1.5,
        "price_to_book": 40.0,
        "price_to_sales": 7.0,
        "eps": 6.5,
        "eps_growth": 0.12,
        "revenue_growth": 0.08,
        "dividend_yield": 0.005,
        "market_cap": 3000000000000.0,
        "is_bullish": True,
        "is_oversold": False,
        "is_overbought": False,
        "latest_signal": "BUY",
        "signal_strategy": "momentum",
        "signal_confidence": 0.85,
    }
    defaults.update(overrides)
    return defaults


def _rank_row(**overrides) -> dict:
    defaults = {
        "ticker": "AAPL",
        "composite_score": 80.0,
        "smoothed_score": 79.0,
        "rank_tier": "Strong Buy",
        "conviction": "High",
        "dimension_scores": {"technical": 85.0, "fundamental": 75.0},
        "horizon": "balanced",
        "scored_at": "2026-04-25T01:00:00+00:00",
    }
    defaults.update(overrides)
    return defaults


class TestGetStockDetail:
    def test_returns_detail_for_valid_ticker(self):
        snap = _snap_row()
        rank = _rank_row()
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": [rank]})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ticker"] == "AAPL"
        assert data["last_price"] == 200.0
        assert data["technicals"]["rsi_14"] == 55.0

    def test_ticker_uppercased(self):
        mock_sb = _sb_mock({"stock_snapshots": [_snap_row()], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/aapl")
        assert resp.status_code == 200
        assert resp.json()["ticker"] == "AAPL"

    def test_not_found_returns_404(self):
        mock_sb = _sb_mock({"stock_snapshots": [], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app(), raise_server_exceptions=False)
            resp = client.get("/api/stocks/detail/NOTEXIST")
        assert resp.status_code == 404

    def test_snapshot_db_error_returns_502(self):
        mock_sb = MagicMock()
        schema = MagicMock()
        chain = _make_chain([], raise_exc=True)
        schema.table.return_value = chain
        mock_sb.schema.return_value = schema
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app(), raise_server_exceptions=False)
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.status_code == 502

    def test_ranking_history_db_error_is_ignored(self):
        snap = _snap_row()
        mock_sb = MagicMock()
        schema = MagicMock()
        snap_chain = _make_chain([snap])
        rank_chain = _make_chain([], raise_exc=True)
        schema.table.side_effect = lambda t: snap_chain if t == "stock_snapshots" else rank_chain
        mock_sb.schema.return_value = schema
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.status_code == 200
        assert resp.json()["ranking"] is None

    def test_rate_limited_returns_429(self):
        mock_sb = _sb_mock({"stock_snapshots": [], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter(allowed=False)
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app(), raise_server_exceptions=False)
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.status_code == 429

    def test_ranking_data_included_when_present(self):
        snap = _snap_row()
        rank = _rank_row()
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": [rank]})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        data = resp.json()
        assert data["ranking"] is not None
        assert data["ranking"]["rank_tier"] == "Strong Buy"
        assert data["ranking"]["composite_score"] == 80.0

    def test_golden_cross_computed(self):
        snap = _snap_row(sma_50=200.0, sma_200=190.0)
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["technicals"]["golden_cross"] is True

    def test_golden_cross_false_when_sma50_below_sma200(self):
        snap = _snap_row(sma_50=180.0, sma_200=190.0)
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["technicals"]["golden_cross"] is False

    def test_golden_cross_none_when_sma_missing(self):
        snap = _snap_row(sma_50=None, sma_200=None)
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["technicals"]["golden_cross"] is None

    def test_macd_above_signal_computed(self):
        snap = _snap_row(macd=3.0, macd_signal=2.0)
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["technicals"]["macd_above_signal"] is True

    def test_bollinger_position_computed(self):
        # price=200, lower=180, upper=220 → (200-180)/(220-180)*100 = 50
        snap = _snap_row(last_price=200.0, bollinger_lower=180.0, bollinger_upper=220.0)
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["technicals"]["bollinger_position"] == 50

    def test_bollinger_position_50_when_bands_equal(self):
        snap = _snap_row(last_price=200.0, bollinger_lower=200.0, bollinger_upper=200.0)
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["technicals"]["bollinger_position"] == 50

    def test_high_52w_position_computed(self):
        # price=200, low=150, high=250 → (200-150)/(250-150)*100 = 50
        snap = _snap_row(last_price=200.0, low_52w=150.0, high_52w=250.0)
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["high_52w_position"] == 50

    def test_high_52w_position_50_when_equal_high_low(self):
        snap = _snap_row(last_price=200.0, low_52w=200.0, high_52w=200.0)
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["high_52w_position"] == 50

    def test_fundamentals_included(self):
        snap = _snap_row()
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        fund = resp.json()["fundamentals"]
        assert fund["pe_ratio"] == 28.0
        assert fund["market_cap"] == pytest.approx(3e12, rel=0.01)

    def test_signals_included(self):
        snap = _snap_row()
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        sig = resp.json()["signals"]
        assert sig["is_bullish"] is True
        assert sig["latest_signal"] == "BUY"

    def test_ranking_history_none_when_no_rows(self):
        snap = _snap_row()
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["ranking"] is None

    def test_missing_bollinger_leaves_position_none(self):
        snap = _snap_row(bollinger_upper=None, bollinger_lower=None)
        mock_sb = _sb_mock({"stock_snapshots": [snap], "stock_ranking_history": []})
        mock_rl = _mock_rate_limiter()
        with patch("app.routes.stock_ranking.supabase_client", mock_sb), \
             patch("app.routes.stock_ranking.rate_limiter", mock_rl):
            client = TestClient(_app())
            resp = client.get("/api/stocks/detail/AAPL")
        assert resp.json()["technicals"]["bollinger_position"] is None
