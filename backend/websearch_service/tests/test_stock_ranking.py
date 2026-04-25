"""Tests for app.routes.stock_ranking — ranking list and ticker detail endpoints."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.routes import stock_ranking as stock_ranking_route
from app.services.rate_limit import rate_limiter


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    rate_limiter.clear_state()
    yield
    rate_limiter.clear_state()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_kw):
        return self

    def eq(self, *_a, **_kw):
        return self

    def gte(self, *_a, **_kw):
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        return SimpleNamespace(data=list(self._rows))


class _FakeSupabase:
    def __init__(self, responses: dict[str, list[dict]]):
        self._responses = responses

    def schema(self, name):
        return self

    def table(self, name):
        return _FakeQuery(self._responses.get(name, []))


# ─── /api/stocks/detail/{ticker} ───────────────────────────────────────────

def _snapshot_row() -> dict:
    return {
        "ticker": "AAPL",
        "company_name": "Apple",
        "last_price": 150.0,
        "price_change_pct": 1.1,
        "high_52w": 200.0,
        "low_52w": 100.0,
        "volume": 50_000_000,
        "avg_volume_10d": 40_000_000,
        "volume_ratio": 1.25,
        "price_vs_sma_50": 5.0,
        "price_vs_sma_200": 15.0,
        "rsi_14": 55.0,
        "macd": 0.4,
        "macd_signal": 0.2,
        "macd_histogram": 0.2,
        "adx": 25.0,
        "bollinger_upper": 160.0,
        "bollinger_lower": 140.0,
        "sma_50": 145.0,
        "sma_200": 130.0,
        "pe_ratio": 30.0,
        "is_bullish": True,
    }


def test_stock_detail_returns_computed_derived_fields(client: TestClient):
    snapshots = [_snapshot_row()]
    fake_sb = _FakeSupabase({"stock_snapshots": snapshots, "stock_ranking_history": []})
    with patch.object(stock_ranking_route, "supabase_client", fake_sb):
        resp = client.get("/api/stocks/detail/AAPL")

    assert resp.status_code == 200
    body = resp.json()
    assert body["ticker"] == "AAPL"
    # golden_cross: sma_50 > sma_200 → True
    assert body["technicals"]["golden_cross"] is True
    # macd_above_signal: macd > macd_signal → True
    assert body["technicals"]["macd_above_signal"] is True
    # bollinger_position: 50% of range (150 is midway between 140 and 160)
    assert body["technicals"]["bollinger_position"] == 50
    # high_52w_position: (150-100)/(200-100) = 50%
    assert body["high_52w_position"] == 50
    # No ranking row → null
    assert body["ranking"] is None


def test_stock_detail_includes_ranking_when_row_present(client: TestClient):
    ranking_row = {
        "composite_score": 85.0,
        "smoothed_score": 82.0,
        "rank_tier": "Strong Buy",
        "conviction": "High",
        "dimension_scores": {"momentum": 88.0, "trend": 80.0},
    }
    fake_sb = _FakeSupabase({
        "stock_snapshots": [_snapshot_row()],
        "stock_ranking_history": [ranking_row],
    })
    with patch.object(stock_ranking_route, "supabase_client", fake_sb):
        resp = client.get("/api/stocks/detail/AAPL")

    assert resp.status_code == 200
    ranking = resp.json()["ranking"]
    assert ranking["composite_score"] == 85.0
    assert ranking["rank_tier"] == "Strong Buy"
    assert ranking["dimension_scores"]["momentum"] == 88.0


def test_stock_detail_404_when_snapshot_missing(client: TestClient):
    fake_sb = _FakeSupabase({"stock_snapshots": [], "stock_ranking_history": []})
    with patch.object(stock_ranking_route, "supabase_client", fake_sb):
        resp = client.get("/api/stocks/detail/ZZZ")

    assert resp.status_code == 404


def test_stock_detail_upper_cases_ticker(client: TestClient):
    fake_sb = _FakeSupabase({
        "stock_snapshots": [_snapshot_row()],
        "stock_ranking_history": [],
    })
    with patch.object(stock_ranking_route, "supabase_client", fake_sb):
        resp = client.get("/api/stocks/detail/aapl")

    assert resp.status_code == 200
    assert resp.json()["ticker"] == "AAPL"


def test_stock_detail_bollinger_position_zero_range_returns_fifty(client: TestClient):
    row = _snapshot_row()
    row["bollinger_upper"] = 150.0
    row["bollinger_lower"] = 150.0
    fake_sb = _FakeSupabase({"stock_snapshots": [row], "stock_ranking_history": []})
    with patch.object(stock_ranking_route, "supabase_client", fake_sb):
        resp = client.get("/api/stocks/detail/AAPL")

    assert resp.status_code == 200
    assert resp.json()["technicals"]["bollinger_position"] == 50
