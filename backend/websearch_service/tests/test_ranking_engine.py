"""Tests for app.services.ranking_engine — pure scoring helpers.

Heavy Supabase-backed flow (_run_ranking_cycle_sync, run_ranking_cycle) is
exercised via integration against a real DB; here we verify the deterministic
scoring primitives those flows depend on.
"""
from __future__ import annotations

import math

import pytest

from app.services.ranking_engine import (
    _conviction,
    _f,
    _has_complete_data,
    _minmax_normalize,
    _rank_tier,
    _winsorize,
)


# ─── _f (safe float) ─────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "value, expected",
    [
        (None, None),
        ("not-a-number", None),
        (float("nan"), None),
        (float("inf"), None),
        (float("-inf"), None),
        ("1.5", 1.5),
        (3, 3.0),
        (0, 0.0),
    ],
)
def test_f_returns_none_for_nullish_and_nonfinite(value, expected):
    assert _f(value) == expected


# ─── _winsorize ──────────────────────────────────────────────────────────────

def test_winsorize_noop_for_small_universe():
    # Fewer than 4 tickers — must return input unchanged.
    vals = {"A": 1.0, "B": 100.0, "C": 50.0}
    assert _winsorize(vals) == vals


def test_winsorize_clips_outliers_to_percentile_range():
    vals = {f"T{i}": float(i) for i in range(100)}
    # Include an extreme outlier.
    vals["OUT"] = 1_000_000.0
    out = _winsorize(vals)
    # The outlier should be clipped downwards.
    assert out["OUT"] < vals["OUT"]
    assert out["OUT"] <= max(float(i) for i in range(100)) + 1


# ─── _minmax_normalize ──────────────────────────────────────────────────────

def test_minmax_normalize_empty_returns_empty_dict():
    assert _minmax_normalize({}) == {}


def test_minmax_normalize_identical_values_return_default():
    out = _minmax_normalize({"A": 5.0, "B": 5.0, "C": 5.0})
    assert all(v == 50.0 for v in out.values())


def test_minmax_normalize_maps_range_to_zero_to_hundred():
    vals = {f"T{i}": float(i) for i in range(10)}
    out = _minmax_normalize(vals)
    # After winsorisation on 10 values, min→0, max→100 (approx).
    assert min(out.values()) == pytest.approx(0.0, abs=0.5)
    assert max(out.values()) == pytest.approx(100.0, abs=0.5)


def test_minmax_normalize_respects_default_when_values_identical():
    out = _minmax_normalize({"A": 7.0, "B": 7.0}, default=42.0)
    assert all(v == 42.0 for v in out.values())


# ─── _rank_tier ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "score, tier",
    [
        (95, "Strong Buy"),
        (80, "Strong Buy"),
        (79.99, "Buy"),
        (65, "Buy"),
        (55, "Hold"),
        (45, "Hold"),
        (44.99, "Underperform"),
        (30, "Underperform"),
        (29.99, "Sell"),
        (0, "Sell"),
    ],
)
def test_rank_tier_boundaries(score: float, tier: str):
    assert _rank_tier(score) == tier


@pytest.mark.parametrize(
    "score, conviction",
    [
        (75, "High"),
        (70, "High"),
        (69.99, "Medium"),
        (50, "Medium"),
        (49.99, "Low"),
        (0, "Low"),
    ],
)
def test_conviction_boundaries(score: float, conviction: str):
    assert _conviction(score) == conviction


# ─── _has_complete_data ─────────────────────────────────────────────────────

def _valid_snap() -> dict:
    return {
        "ticker": "AAPL",
        "price_vs_sma_50": 5.0,
        "rsi_14": 55.0,
        "macd_histogram": 0.1,
        "volume": 10_000_000.0,
        "last_price": 150.0,
        "adx": 24.0,
    }


def _valid_returns() -> dict:
    return {
        "ticker": "AAPL",
        "has_6m_history": True,
        "return_6m": 0.12,
        "return_3m": 0.05,
    }


def test_has_complete_data_happy_path():
    assert _has_complete_data(_valid_snap(), _valid_returns()) is True


def test_has_complete_data_rejects_missing_returns_row():
    assert _has_complete_data(_valid_snap(), None) is False


def test_has_complete_data_rejects_insufficient_history():
    ret = _valid_returns()
    ret["has_6m_history"] = False
    assert _has_complete_data(_valid_snap(), ret) is False


def test_has_complete_data_rejects_null_return_6m():
    ret = _valid_returns()
    ret["return_6m"] = None
    assert _has_complete_data(_valid_snap(), ret) is False


def test_has_complete_data_rejects_null_return_3m():
    ret = _valid_returns()
    ret["return_3m"] = None
    assert _has_complete_data(_valid_snap(), ret) is False


@pytest.mark.parametrize(
    "missing_field",
    ["price_vs_sma_50", "rsi_14", "macd_histogram", "volume", "last_price", "adx"],
)
def test_has_complete_data_rejects_missing_required_snapshot_fields(missing_field: str):
    snap = _valid_snap()
    snap[missing_field] = None
    assert _has_complete_data(snap, _valid_returns()) is False


def test_has_complete_data_rejects_nonfinite_snapshot_fields():
    snap = _valid_snap()
    snap["rsi_14"] = math.inf
    assert _has_complete_data(snap, _valid_returns()) is False
