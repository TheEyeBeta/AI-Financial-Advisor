"""
Stock Ranking API route.

GET /api/stocks/ranking

Professional-grade multi-dimensional stock scoring engine.
Fetches stock_snapshots from Supabase, computes composite scores across 6
dimensions (Momentum, Technical, Fundamental, Risk-Adjusted, Quality,
ML Signal) using 30+ metrics, and returns a ranked list with conviction
ratings and tier classifications.

Results are cached in-memory for CACHE_TTL_SECONDS so repeated requests
within the window are served instantly without hitting Supabase.

Env vars (either prefix accepted so Railway shared-vars work automatically):
  SUPABASE_URL            or  VITE_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY  or  VITE_SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_ANON_KEY          or  VITE_SUPABASE_ANON_KEY  (fallback)
"""
from __future__ import annotations

import math
import os
import time
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(tags=["stock-ranking"])

# ── In-memory cache ───────────────────────────────────────────────────────────
CACHE_TTL_SECONDS = 600  # 10 minutes

# Separate cache per horizon so short/long/balanced don't clobber each other
_cache: dict[str, dict[str, Any]] = {
    "short": {"data": None, "ts": 0.0},
    "long": {"data": None, "ts": 0.0},
    "balanced": {"data": None, "ts": 0.0},
}
# Raw snapshots cache (shared — the raw DB data is the same for all horizons)
_snapshots_cache: dict[str, Any] = {"data": None, "ts": 0.0}


def _get_supabase_client():
    """Lazy-init Supabase client; prefers non-VITE_ prefixed vars."""
    url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase is not configured. "
                "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend service."
            ),
        )
    from supabase import create_client  # imported lazily to avoid startup errors if not installed

    return create_client(url, key)


# ── Pydantic models ───────────────────────────────────────────────────────────

class ScoreBreakdown(BaseModel):
    """Detailed metric-level breakdown surfaced in the UI."""
    # Technical indicators
    rsi_14: Optional[float] = None
    rsi_9: Optional[float] = None
    macd_above_signal: Optional[bool] = None
    macd_histogram: Optional[float] = None
    golden_cross: Optional[bool] = None
    adx: Optional[float] = None
    stochastic_k: Optional[float] = None
    stochastic_d: Optional[float] = None
    williams_r: Optional[float] = None
    cci: Optional[float] = None
    bollinger_position: Optional[float] = None  # price position within bands (0-1)
    # Momentum
    volume_ratio: Optional[float] = None
    price_vs_sma_50: Optional[float] = None
    price_vs_sma_200: Optional[float] = None
    price_vs_ema_50: Optional[float] = None
    fifty_two_week_position: Optional[float] = None  # 0 = at low, 1 = at high
    # Fundamental
    pe_ratio: Optional[float] = None
    forward_pe: Optional[float] = None
    peg_ratio: Optional[float] = None
    price_to_book: Optional[float] = None
    price_to_sales: Optional[float] = None
    eps: Optional[float] = None
    eps_growth: Optional[float] = None
    revenue_growth: Optional[float] = None
    dividend_yield: Optional[float] = None
    market_cap: Optional[float] = None
    # ML/Signals
    signal_confidence: Optional[float] = None
    is_bullish: Optional[bool] = None
    signal_strategy: Optional[str] = None


class StockScore(BaseModel):
    ticker: str
    company_name: Optional[str] = None
    last_price: Optional[float] = None
    price_change_pct: Optional[float] = None
    updated_at: Optional[str] = None
    # Composite
    composite_score: float
    rank_tier: str  # "Strong Buy" / "Buy" / "Hold" / "Underperform" / "Sell"
    conviction: str  # "High" / "Medium" / "Low"
    # Dimension scores (all 0-100)
    momentum_score: float
    technical_score: float
    fundamental_score: float
    risk_score: float
    quality_score: float
    ml_score: Optional[float] = None
    has_ml_data: bool
    # Detailed breakdown
    breakdown: ScoreBreakdown
    data_fresh: bool
    # Dimension agreement count (how many dimensions score above 60)
    dimensions_bullish: int


class RankingResponse(BaseModel):
    stocks: list[StockScore]
    has_stale_data: bool
    has_ml_data: bool
    total_scored: int
    horizon: str  # "short" | "long" | "balanced"
    cached: bool
    cache_age_seconds: float


# ── Scoring helpers ───────────────────────────────────────────────────────────

def _f(val: Any) -> Optional[float]:
    """Safe float conversion — returns None for null/non-finite values."""
    if val is None:
        return None
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _normalize(
    snapshots: list[dict],
    getter,
    lower_better: bool = False,
    clamp_min: Optional[float] = None,
    clamp_max: Optional[float] = None,
    default: float = 50.0,
) -> dict[str, float]:
    """Min-max normalize a metric across all stocks → dict[ticker, 0-100]."""
    pairs: list[tuple[str, float]] = []
    for s in snapshots:
        val = _f(getter(s))
        if val is None:
            continue
        if clamp_min is not None:
            val = max(clamp_min, val)
        if clamp_max is not None:
            val = min(clamp_max, val)
        pairs.append((s["ticker"], val))

    if not pairs:
        return {}

    vals = [v for _, v in pairs]
    lo, hi = min(vals), max(vals)
    rng = hi - lo

    result: dict[str, float] = {}
    for ticker, val in pairs:
        score = default if rng == 0 else (val - lo) / rng * 100.0
        if lower_better:
            score = 100.0 - score
        result[ticker] = round(score, 1)
    return result


def _get(m: dict[str, float], ticker: str, default: float = 50.0) -> float:
    """Fetch normalized score with a neutral default."""
    return m.get(ticker, default)


# ── RSI Scoring ──────────────────────────────────────────────────────────────
# Professional RSI interpretation:
#   - 40-60: neutral/accumulation zone (moderate score)
#   - 50-70: momentum sweet spot (highest score)
#   - Below 30: oversold — potential reversal (moderate-high for contrarian)
#   - Above 70: overbought — risky (low score)
#   - Above 80: extremely overbought (very low)

def _rsi_momentum_score(rsi: Optional[float]) -> float:
    """RSI scoring for momentum — rewards trending stocks in the sweet spot."""
    if rsi is None or not math.isfinite(rsi):
        return 50.0
    if 50.0 <= rsi <= 65.0:
        return 100.0
    if 65.0 < rsi <= 70.0:
        return 90.0
    if 45.0 <= rsi < 50.0:
        return 80.0
    if 70.0 < rsi <= 80.0:
        return max(0.0, 90.0 - (rsi - 70.0) * 6.0)  # decays 90→30
    if 30.0 <= rsi < 45.0:
        return max(0.0, 40.0 + (rsi - 30.0) / 15.0 * 40.0)  # 40→80
    if rsi < 30.0:
        return max(0.0, rsi / 30.0 * 40.0)  # 0→40
    # rsi > 80
    return max(0.0, 30.0 - (rsi - 80.0) * 3.0)


def _rsi_risk_score(rsi: Optional[float]) -> float:
    """RSI scoring for risk — penalizes extreme readings."""
    if rsi is None or not math.isfinite(rsi):
        return 50.0
    # Best risk: RSI 40-60 (not overextended)
    if 40.0 <= rsi <= 60.0:
        return 100.0
    if 30.0 <= rsi < 40.0:
        return 70.0
    if 60.0 < rsi <= 70.0:
        return 70.0
    if rsi < 30.0:
        return max(0.0, 30.0 + rsi)  # oversold = risky
    # rsi > 70
    return max(0.0, 100.0 - (rsi - 70.0) * 3.5)


# ── Stochastic Scoring ───────────────────────────────────────────────────────

def _stochastic_score(k: Optional[float], d: Optional[float]) -> float:
    """Score based on Stochastic oscillator position and crossover."""
    if k is None or not math.isfinite(k):
        return 50.0
    score = 50.0
    # Bullish zone: K is rising from oversold
    if 20.0 <= k <= 80.0:
        score = 60.0 + (min(k, 60.0) - 20.0)  # 60-100 for 20-80 range
    elif k < 20.0:
        score = 45.0  # oversold — risky but potential reversal
    else:
        score = 30.0  # overbought
    # Bullish crossover bonus: K > D
    if d is not None and math.isfinite(d) and k > d:
        score = min(100.0, score + 10.0)
    return score


# ── Williams %R Scoring ──────────────────────────────────────────────────────

def _williams_r_score(wr: Optional[float]) -> float:
    """Williams %R: -100 to 0 scale. Best when emerging from oversold."""
    if wr is None or not math.isfinite(wr):
        return 50.0
    # Normalize: -100 → 0, 0 → 100
    normalized = wr + 100.0
    # Best: -80 to -20 zone (emerging, not extreme)
    if 20.0 <= normalized <= 80.0:
        return 60.0 + (normalized - 20.0) / 60.0 * 30.0  # 60→90
    if normalized < 20.0:
        return 40.0  # oversold
    return 25.0  # overbought


# ── CCI Scoring ──────────────────────────────────────────────────────────────

def _cci_score(cci: Optional[float]) -> float:
    """CCI: bullish when moderately positive (+50 to +150), risky at extremes."""
    if cci is None or not math.isfinite(cci):
        return 50.0
    if 50.0 <= cci <= 150.0:
        return 80.0 + (cci - 50.0) / 100.0 * 20.0  # 80→100
    if 0.0 <= cci < 50.0:
        return 50.0 + cci  # 50→100
    if -100.0 <= cci < 0.0:
        return max(20.0, 50.0 + cci / 2.0)  # 50→0
    if cci > 150.0:
        return max(10.0, 100.0 - (cci - 150.0) / 2.0)  # extreme high
    # cci < -100
    return max(0.0, 20.0 + (cci + 200.0) / 5.0)  # deeply negative


# ── ADX Scoring ──────────────────────────────────────────────────────────────

def _adx_trend_score(adx: Optional[float]) -> float:
    """ADX: measures trend strength. >25 = trending, >40 = strong trend."""
    if adx is None or not math.isfinite(adx):
        return 50.0
    if adx >= 40.0:
        return 100.0
    if adx >= 25.0:
        return 70.0 + (adx - 25.0) / 15.0 * 30.0  # 70→100
    if adx >= 15.0:
        return 40.0 + (adx - 15.0) / 10.0 * 30.0  # 40→70
    return max(10.0, adx / 15.0 * 40.0)  # weak trend


# ── Bollinger Band Scoring ───────────────────────────────────────────────────

def _bollinger_position(s: dict) -> Optional[float]:
    """Calculate price position within Bollinger Bands (0=lower, 1=upper)."""
    price = _f(s.get("last_price"))
    upper = _f(s.get("bollinger_upper"))
    lower = _f(s.get("bollinger_lower"))
    if price is None or upper is None or lower is None:
        return None
    band_width = upper - lower
    if band_width <= 0:
        return None
    return (price - lower) / band_width


def _bollinger_momentum_score(position: Optional[float]) -> float:
    """Score based on position within Bollinger Bands — rewards middle-upper."""
    if position is None:
        return 50.0
    # Best: price between middle and upper band (0.5-0.8)
    if 0.5 <= position <= 0.8:
        return 80.0 + (position - 0.5) / 0.3 * 20.0
    if 0.3 <= position < 0.5:
        return 60.0 + (position - 0.3) / 0.2 * 20.0
    if 0.8 < position <= 1.0:
        return max(40.0, 100.0 - (position - 0.8) / 0.2 * 60.0)
    if position < 0.3:
        return max(20.0, position / 0.3 * 60.0)
    return 30.0  # beyond bands


def _bollinger_width(s: dict) -> Optional[float]:
    """Bollinger bandwidth (%) — narrow = low volatility, wide = high vol."""
    upper = _f(s.get("bollinger_upper"))
    lower = _f(s.get("bollinger_lower"))
    middle = _f(s.get("bollinger_middle"))
    if upper is None or lower is None or middle is None or middle <= 0:
        return None
    return (upper - lower) / middle * 100.0


# ── 52-Week Range Position ───────────────────────────────────────────────────

def _52w_position(s: dict) -> Optional[float]:
    """Position within 52-week range: 0 = at low, 1 = at high."""
    price = _f(s.get("last_price"))
    high = _f(s.get("high_52w"))
    low = _f(s.get("low_52w"))
    if price is None or high is None or low is None:
        return None
    rng = high - low
    if rng <= 0:
        return None
    return max(0.0, min(1.0, (price - low) / rng))


# ── Volume Analysis ──────────────────────────────────────────────────────────

def _vol_ratio(s: dict) -> Optional[float]:
    vr = _f(s.get("volume_ratio"))
    if vr is not None:
        return vr
    vol = _f(s.get("volume"))
    avg = _f(s.get("avg_volume_10d"))
    if vol is not None and avg is not None and avg > 0:
        return vol / avg
    return None


# ── MACD helpers ─────────────────────────────────────────────────────────────

def _macd_diff(s: dict) -> Optional[float]:
    m = _f(s.get("macd"))
    sig = _f(s.get("macd_signal"))
    if m is None or sig is None:
        return None
    return m - sig


def _macd_histogram_score(hist: Optional[float]) -> float:
    """MACD histogram: positive and increasing = strong momentum."""
    if hist is None or not math.isfinite(hist):
        return 50.0
    if hist > 0:
        return min(100.0, 60.0 + hist * 200.0)  # scale positive
    return max(0.0, 50.0 + hist * 200.0)  # negative histogram


# ── Golden Cross / SMA Ratio ────────────────────────────────────────────────

def _golden_cross_ratio(s: dict) -> Optional[float]:
    sma50 = _f(s.get("sma_50"))
    sma200 = _f(s.get("sma_200"))
    if sma50 is None or sma200 is None or sma200 == 0:
        return None
    return (sma50 / sma200 - 1.0) * 100.0


# ── Multi-timeframe SMA alignment ───────────────────────────────────────────

def _sma_alignment_score(s: dict) -> float:
    """Score based on SMA alignment: SMA10>SMA20>SMA50>SMA100>SMA200 = perfect uptrend."""
    smas = []
    for key in ["sma_10", "sma_20", "sma_50", "sma_100", "sma_200"]:
        val = _f(s.get(key))
        if val is not None:
            smas.append(val)

    if len(smas) < 3:
        return 50.0

    # Count how many adjacent pairs are in bullish order (shorter > longer)
    bullish_pairs = sum(1 for i in range(len(smas) - 1) if smas[i] > smas[i + 1])
    total_pairs = len(smas) - 1
    return (bullish_pairs / total_pairs) * 100.0


# ── EMA trend confirmation ──────────────────────────────────────────────────

def _ema_trend_score(s: dict) -> float:
    """EMA trend: price above EMA stack = strong bullish confirmation."""
    price = _f(s.get("last_price"))
    if price is None:
        return 50.0

    emas = {}
    for key in ["ema_10", "ema_20", "ema_50", "ema_200"]:
        val = _f(s.get(key))
        if val is not None:
            emas[key] = val

    if not emas:
        return 50.0

    above_count = sum(1 for v in emas.values() if price > v)
    return (above_count / len(emas)) * 100.0


# ── Valuation scoring helpers ────────────────────────────────────────────────

def _peg_score(peg: Optional[float]) -> float:
    """PEG ratio scoring: <1 = undervalued growth, 1-2 = fair, >2 = expensive."""
    if peg is None or not math.isfinite(peg) or peg <= 0:
        return 50.0  # no data or negative = neutral
    if peg <= 0.5:
        return 100.0
    if peg <= 1.0:
        return 80.0 + (1.0 - peg) / 0.5 * 20.0  # 80→100
    if peg <= 1.5:
        return 60.0 + (1.5 - peg) / 0.5 * 20.0  # 60→80
    if peg <= 2.0:
        return 40.0 + (2.0 - peg) / 0.5 * 20.0  # 40→60
    if peg <= 3.0:
        return max(10.0, 40.0 - (peg - 2.0) * 20.0)  # 40→20
    return 10.0  # expensive


def _market_cap_quality_score(cap: Optional[float]) -> float:
    """Larger companies get higher quality scores — less risk of blow-up."""
    if cap is None or not math.isfinite(cap) or cap <= 0:
        return 30.0
    cap_b = cap / 1e9  # convert to billions
    if cap_b >= 200:
        return 100.0  # mega-cap
    if cap_b >= 50:
        return 85.0  # large-cap
    if cap_b >= 10:
        return 70.0  # mid-cap
    if cap_b >= 2:
        return 50.0  # small-cap
    return 30.0  # micro-cap


# ── ML Signal Scoring ───────────────────────────────────────────────────────

def _ml_score(s: dict) -> Optional[float]:
    """Convert signal_confidence + is_bullish to a 0-100 directional score."""
    conf = _f(s.get("signal_confidence"))
    if conf is None:
        return None
    is_bullish = s.get("is_bullish")
    if is_bullish is True:
        return conf * 100.0
    if is_bullish is False:
        return (1.0 - conf) * 100.0
    return 50.0


# ── Rank Tier & Conviction ──────────────────────────────────────────────────

def _rank_tier(composite: float) -> str:
    """Classify composite score into investment tiers."""
    if composite >= 80:
        return "Strong Buy"
    if composite >= 65:
        return "Buy"
    if composite >= 45:
        return "Hold"
    if composite >= 30:
        return "Underperform"
    return "Sell"


def _conviction(dimensions_bullish: int, composite: float) -> str:
    """Conviction is high when multiple independent dimensions agree."""
    if dimensions_bullish >= 5 and composite >= 70:
        return "High"
    if dimensions_bullish >= 3 and composite >= 50:
        return "Medium"
    return "Low"


# ── Dimension weights by horizon ─────────────────────────────────────────────
#
# Short-term (swing / days–weeks):
#   Technical + Momentum dominate — ride the trend, time entries precisely.
#   Fundamentals barely matter on a 1-week trade. ML signals are inherently
#   short-term so they get extra weight.
#
# Long-term (buy-and-hold / months–years):
#   Fundamentals + Quality dominate — valuation is the #1 driver of long-term
#   returns. Risk matters for drawdown control. Momentum and technicals are
#   minor timing helpers at best.
#
# Balanced (default):
#   Even blend suitable for medium-term position trading.

HORIZON_WEIGHTS: dict[str, dict[str, dict[str, float]]] = {
    "short": {
        "with_ml": {
            "momentum": 0.25,
            "technical": 0.28,
            "fundamental": 0.07,
            "risk": 0.10,
            "quality": 0.05,
            "ml": 0.25,
        },
        "without_ml": {
            "momentum": 0.32,
            "technical": 0.35,
            "fundamental": 0.10,
            "risk": 0.13,
            "quality": 0.10,
        },
    },
    "long": {
        "with_ml": {
            "momentum": 0.07,
            "technical": 0.08,
            "fundamental": 0.35,
            "risk": 0.15,
            "quality": 0.22,
            "ml": 0.13,
        },
        "without_ml": {
            "momentum": 0.08,
            "technical": 0.10,
            "fundamental": 0.40,
            "risk": 0.17,
            "quality": 0.25,
        },
    },
    "balanced": {
        "with_ml": {
            "momentum": 0.15,
            "technical": 0.20,
            "fundamental": 0.25,
            "risk": 0.12,
            "quality": 0.10,
            "ml": 0.18,
        },
        "without_ml": {
            "momentum": 0.18,
            "technical": 0.24,
            "fundamental": 0.30,
            "risk": 0.15,
            "quality": 0.13,
        },
    },
}

# Sub-metric weight overrides per horizon — these adjust the *internal*
# blending within each dimension so the dimension score itself is tuned
# for the investment horizon, not just the final composite weighting.

# Momentum sub-weights: short emphasises daily price action + volume,
# long emphasises 200-day trend + 52-week position.
MOMENTUM_SUB: dict[str, dict[str, float]] = {
    "short": {
        "pc": 0.25, "sma50": 0.12, "sma200": 0.05, "ema50": 0.10,
        "vr": 0.20, "sma_align": 0.10, "ema_trend": 0.13, "pos52w": 0.05,
    },
    "long": {
        "pc": 0.05, "sma50": 0.15, "sma200": 0.22, "ema50": 0.10,
        "vr": 0.05, "sma_align": 0.15, "ema_trend": 0.10, "pos52w": 0.18,
    },
    "balanced": {
        "pc": 0.15, "sma50": 0.18, "sma200": 0.15, "ema50": 0.12,
        "vr": 0.12, "sma_align": 0.13, "ema_trend": 0.10, "pos52w": 0.05,
    },
}

# Technical sub-weights: short gives more to RSI/Stochastic (quick reversal
# signals), long gives more to ADX/golden cross (trend structure).
TECHNICAL_SUB: dict[str, dict[str, float]] = {
    "short": {
        "rsi": 0.20, "macd": 0.10, "macd_hist": 0.12, "gc": 0.05,
        "adx": 0.08, "stoch": 0.15, "wr": 0.10, "cci": 0.08, "bb": 0.12,
    },
    "long": {
        "rsi": 0.12, "macd": 0.12, "macd_hist": 0.08, "gc": 0.18,
        "adx": 0.18, "stoch": 0.05, "wr": 0.05, "cci": 0.07, "bb": 0.15,
    },
    "balanced": {
        "rsi": 0.18, "macd": 0.12, "macd_hist": 0.10, "gc": 0.10,
        "adx": 0.12, "stoch": 0.10, "wr": 0.08, "cci": 0.08, "bb": 0.12,
    },
}

# Fundamental sub-weights: short barely cares, long leans heavily on
# GARP (PEG), forward valuation, and growth persistence.
FUNDAMENTAL_SUB: dict[str, dict[str, float]] = {
    "short": {
        "pe": 0.10, "fwd_pe": 0.08, "peg": 0.10, "pb": 0.08, "ps": 0.08,
        "eps_g": 0.25, "rev_g": 0.18, "div": 0.03, "peg2": 0.10,
    },
    "long": {
        "pe": 0.10, "fwd_pe": 0.12, "peg": 0.18, "pb": 0.08, "ps": 0.07,
        "eps_g": 0.18, "rev_g": 0.12, "div": 0.08, "peg2": 0.07,
    },
    "balanced": {
        "pe": 0.12, "fwd_pe": 0.10, "peg": 0.14, "pb": 0.08, "ps": 0.08,
        "eps_g": 0.22, "rev_g": 0.16, "div": 0.05, "peg2": 0.05,
    },
}


# ── Main scoring engine ─────────────────────────────────────────────────────

def _compute_scores(snapshots: list[dict], horizon: str = "balanced") -> list[StockScore]:
    stale_cutoff = time.time() - 86400  # 24 h
    msub = MOMENTUM_SUB[horizon]
    tsub = TECHNICAL_SUB[horizon]
    fsub = FUNDAMENTAL_SUB[horizon]

    # ── Normalized maps (relative to universe) ──────────────────────────────

    # Momentum metrics
    pc_map = _normalize(snapshots, lambda s: _f(s.get("price_change_pct")))
    sma50_map = _normalize(snapshots, lambda s: _f(s.get("price_vs_sma_50")))
    sma200_map = _normalize(snapshots, lambda s: _f(s.get("price_vs_sma_200")))
    ema50_map = _normalize(snapshots, lambda s: _f(s.get("price_vs_ema_50")))
    vr_map = _normalize(snapshots, _vol_ratio, clamp_min=0.1, clamp_max=5.0)

    # Technical (universe-relative)
    macd_map = _normalize(snapshots, _macd_diff)
    gc_map = _normalize(snapshots, _golden_cross_ratio)

    # Fundamental (universe-relative, inverted where lower=better)
    pe_map = _normalize(
        snapshots, lambda s: _f(s.get("pe_ratio")),
        lower_better=True, clamp_min=1, clamp_max=100,
    )
    fwd_pe_map = _normalize(
        snapshots, lambda s: _f(s.get("forward_pe")),
        lower_better=True, clamp_min=1, clamp_max=80,
    )
    pb_map = _normalize(
        snapshots, lambda s: _f(s.get("price_to_book")),
        lower_better=True, clamp_min=0.5, clamp_max=30,
    )
    ps_map = _normalize(
        snapshots, lambda s: _f(s.get("price_to_sales")),
        lower_better=True, clamp_min=0.2, clamp_max=30,
    )
    eps_map = _normalize(
        snapshots, lambda s: _f(s.get("eps_growth")),
        clamp_min=-0.5, clamp_max=2.0,
    )
    rev_map = _normalize(
        snapshots, lambda s: _f(s.get("revenue_growth")),
        clamp_min=-0.3, clamp_max=1.0,
    )
    div_map = _normalize(
        snapshots, lambda s: _f(s.get("dividend_yield")),
        clamp_min=0, clamp_max=0.08,
    )

    # Risk (universe-relative)
    bw_map = _normalize(
        snapshots, _bollinger_width,
        lower_better=True, clamp_min=1, clamp_max=30,
    )

    out: list[StockScore] = []
    for s in snapshots:
        t = s["ticker"]

        # ── 1. MOMENTUM SCORE (15%) ─────────────────────────────────────────
        # Multi-timeframe trend + volume confirmation
        pos_52w = _52w_position(s)
        pos_52w_score = (pos_52w * 100.0) if pos_52w is not None else 50.0

        momentum = (
            _get(pc_map, t) * msub["pc"]
            + _get(sma50_map, t) * msub["sma50"]
            + _get(sma200_map, t) * msub["sma200"]
            + _get(ema50_map, t) * msub["ema50"]
            + _get(vr_map, t) * msub["vr"]
            + _sma_alignment_score(s) * msub["sma_align"]
            + _ema_trend_score(s) * msub["ema_trend"]
            + pos_52w_score * msub["pos52w"]
        )

        # ── 2. TECHNICAL SCORE (20%) ────────────────────────────────────────
        # Comprehensive oscillator & pattern analysis
        rsi14 = _f(s.get("rsi_14"))
        stoch_k = _f(s.get("stochastic_k"))
        stoch_d = _f(s.get("stochastic_d"))
        wr = _f(s.get("williams_r"))
        cci_val = _f(s.get("cci"))
        adx_val = _f(s.get("adx"))
        hist_val = _f(s.get("macd_histogram"))
        bb_pos = _bollinger_position(s)

        technical = (
            _rsi_momentum_score(rsi14) * tsub["rsi"]
            + _get(macd_map, t) * tsub["macd"]
            + _macd_histogram_score(hist_val) * tsub["macd_hist"]
            + _get(gc_map, t) * tsub["gc"]
            + _adx_trend_score(adx_val) * tsub["adx"]
            + _stochastic_score(stoch_k, stoch_d) * tsub["stoch"]
            + _williams_r_score(wr) * tsub["wr"]
            + _cci_score(cci_val) * tsub["cci"]
            + _bollinger_momentum_score(bb_pos) * tsub["bb"]
        )

        # ── 3. FUNDAMENTAL SCORE (25%) ──────────────────────────────────────
        # Comprehensive valuation + growth analysis
        peg_val = _f(s.get("peg_ratio"))

        fundamental = (
            _get(pe_map, t) * fsub["pe"]
            + _get(fwd_pe_map, t) * fsub["fwd_pe"]
            + _peg_score(peg_val) * fsub["peg"]
            + _get(pb_map, t) * fsub["pb"]
            + _get(ps_map, t) * fsub["ps"]
            + _get(eps_map, t) * fsub["eps_g"]
            + _get(rev_map, t) * fsub["rev_g"]
            + _get(div_map, t) * fsub["div"]
            + _peg_score(peg_val) * fsub["peg2"]
        )

        # ── 4. RISK-ADJUSTED SCORE (12%) ────────────────────────────────────
        # Capital preservation: volatility, extreme readings, position safety
        risk = (
            _rsi_risk_score(rsi14) * 0.25            # RSI extreme penalty
            + _get(bw_map, t) * 0.25                  # Bollinger width (lower=less vol)
            + _52w_risk_score(pos_52w) * 0.25         # 52-week position risk
            + _adx_risk_contribution(adx_val) * 0.25  # trend clarity
        )

        # ── 5. QUALITY SCORE (10%) ──────────────────────────────────────────
        # Business durability: size, profitability, consistency
        eps_val = _f(s.get("eps"))
        eps_g = _f(s.get("eps_growth"))
        rev_g = _f(s.get("revenue_growth"))
        cap = _f(s.get("market_cap"))

        quality = (
            _market_cap_quality_score(cap) * 0.25        # size (stability proxy)
            + _earnings_quality(eps_val, eps_g) * 0.35   # profitable & growing
            + _revenue_quality(rev_g) * 0.25             # top-line growth
            + _get(div_map, t) * 0.15                    # dividend (shareholder return)
        )

        # ── 6. ML SIGNAL SCORE (18%) ────────────────────────────────────────
        ml_raw = _ml_score(s)
        has_ml = ml_raw is not None

        # ── COMPOSITE ───────────────────────────────────────────────────────
        hw = HORIZON_WEIGHTS[horizon]
        if has_ml:
            w = hw["with_ml"]
            composite = (
                momentum * w["momentum"]
                + technical * w["technical"]
                + fundamental * w["fundamental"]
                + risk * w["risk"]
                + quality * w["quality"]
                + ml_raw * w["ml"]  # type: ignore[operator]
            )
        else:
            w = hw["without_ml"]
            composite = (
                momentum * w["momentum"]
                + technical * w["technical"]
                + fundamental * w["fundamental"]
                + risk * w["risk"]
                + quality * w["quality"]
            )

        # ── CONVICTION ──────────────────────────────────────────────────────
        bullish_threshold = 60.0
        dims = [momentum, technical, fundamental, risk, quality]
        if has_ml:
            dims.append(ml_raw)  # type: ignore[arg-type]
        dims_bullish = sum(1 for d in dims if d >= bullish_threshold)

        # ── BREAKDOWN ───────────────────────────────────────────────────────
        macd_f = _f(s.get("macd"))
        macd_sig_f = _f(s.get("macd_signal"))
        macd_above = (macd_f > macd_sig_f) if macd_f is not None and macd_sig_f is not None else None
        sma50 = _f(s.get("sma_50"))
        sma200 = _f(s.get("sma_200"))
        golden = (sma50 > sma200) if sma50 is not None and sma200 is not None else None

        # Freshness check
        data_fresh = False
        updated_str = s.get("updated_at")
        if updated_str:
            try:
                dt = datetime.fromisoformat(str(updated_str).replace("Z", "+00:00"))
                data_fresh = dt.timestamp() >= stale_cutoff
            except (ValueError, AttributeError):
                pass

        out.append(StockScore(
            ticker=t,
            company_name=s.get("company_name"),
            last_price=_f(s.get("last_price")),
            price_change_pct=_f(s.get("price_change_pct")),
            updated_at=updated_str,
            composite_score=round(composite, 1),
            rank_tier=_rank_tier(composite),
            conviction=_conviction(dims_bullish, composite),
            momentum_score=round(momentum, 1),
            technical_score=round(technical, 1),
            fundamental_score=round(fundamental, 1),
            risk_score=round(risk, 1),
            quality_score=round(quality, 1),
            ml_score=round(ml_raw, 1) if has_ml else None,
            has_ml_data=has_ml,
            dimensions_bullish=dims_bullish,
            breakdown=ScoreBreakdown(
                rsi_14=_f(s.get("rsi_14")),
                rsi_9=_f(s.get("rsi_9")),
                macd_above_signal=macd_above,
                macd_histogram=_f(s.get("macd_histogram")),
                golden_cross=golden,
                adx=_f(s.get("adx")),
                stochastic_k=_f(s.get("stochastic_k")),
                stochastic_d=_f(s.get("stochastic_d")),
                williams_r=_f(s.get("williams_r")),
                cci=_f(s.get("cci")),
                bollinger_position=round(bb_pos, 3) if bb_pos is not None else None,
                volume_ratio=_vol_ratio(s),
                price_vs_sma_50=_f(s.get("price_vs_sma_50")),
                price_vs_sma_200=_f(s.get("price_vs_sma_200")),
                price_vs_ema_50=_f(s.get("price_vs_ema_50")),
                fifty_two_week_position=round(pos_52w, 3) if pos_52w is not None else None,
                pe_ratio=_f(s.get("pe_ratio")),
                forward_pe=_f(s.get("forward_pe")),
                peg_ratio=peg_val,
                price_to_book=_f(s.get("price_to_book")),
                price_to_sales=_f(s.get("price_to_sales")),
                eps=eps_val,
                eps_growth=_f(s.get("eps_growth")),
                revenue_growth=_f(s.get("revenue_growth")),
                dividend_yield=_f(s.get("dividend_yield")),
                market_cap=cap,
                signal_confidence=_f(s.get("signal_confidence")),
                is_bullish=s.get("is_bullish"),
                signal_strategy=s.get("signal_strategy"),
            ),
            data_fresh=data_fresh,
        ))
    return out


# ── Risk sub-helpers ─────────────────────────────────────────────────────────

def _52w_risk_score(pos: Optional[float]) -> float:
    """52-week position risk: very near high = risky, near low = risky (falling knife)."""
    if pos is None:
        return 50.0
    # Best: 30-70% of range — not extended, not collapsing
    if 0.30 <= pos <= 0.70:
        return 80.0 + (0.5 - abs(pos - 0.5)) / 0.2 * 20.0
    if 0.70 < pos <= 0.90:
        return 60.0 - (pos - 0.70) / 0.20 * 30.0  # 60→30
    if pos > 0.90:
        return max(10.0, 30.0 - (pos - 0.90) * 200.0)  # near 52w high = risky
    if 0.10 <= pos < 0.30:
        return 40.0 + (pos - 0.10) / 0.20 * 20.0  # 40→60
    # pos < 0.10 — near 52w low (falling knife)
    return max(10.0, pos * 400.0)


def _adx_risk_contribution(adx: Optional[float]) -> float:
    """ADX for risk: clear trend (high ADX) = lower risk than choppy market."""
    if adx is None or not math.isfinite(adx):
        return 40.0
    if adx >= 30:
        return 90.0  # clear trend
    if adx >= 20:
        return 60.0 + (adx - 20) * 3.0  # 60→90
    return max(20.0, adx * 3.0)  # choppy / no trend


# ── Quality sub-helpers ──────────────────────────────────────────────────────

def _earnings_quality(eps: Optional[float], eps_growth: Optional[float]) -> float:
    """Quality: positive earnings + positive growth = high quality."""
    score = 30.0  # base
    if eps is not None and eps > 0:
        score += 35.0  # profitable
    if eps_growth is not None:
        if eps_growth > 0.20:
            score += 35.0  # strong growth
        elif eps_growth > 0.05:
            score += 25.0  # moderate growth
        elif eps_growth > 0:
            score += 15.0  # slight growth
        elif eps_growth > -0.10:
            score += 5.0   # slight decline, not catastrophic
        # else: declining earnings, no bonus
    return min(100.0, score)


def _revenue_quality(rev_growth: Optional[float]) -> float:
    """Top-line growth quality — revenue growth is hard to fake."""
    if rev_growth is None:
        return 40.0
    if rev_growth > 0.30:
        return 100.0
    if rev_growth > 0.15:
        return 80.0
    if rev_growth > 0.05:
        return 60.0
    if rev_growth > 0:
        return 45.0
    if rev_growth > -0.10:
        return 30.0
    return 15.0  # shrinking revenue


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/api/stocks/ranking", response_model=RankingResponse)
async def get_stock_ranking(
    limit: int = Query(default=20, ge=1, le=100, description="Top N stocks to return"),
    min_score: float = Query(default=0.0, ge=0, le=100, description="Minimum composite score filter"),
    horizon: str = Query(
        default="balanced",
        description="Investment horizon: 'short' (swing/days-weeks), 'long' (buy-and-hold/months-years), 'balanced' (default)",
    ),
) -> RankingResponse:
    """
    Return stocks ranked by composite score (0-100).

    The `horizon` parameter shifts dimension weights and sub-metric emphasis:

    **short** — Swing / day trading (days to weeks):
      Momentum 25%, Technical 28%, Fundamental 7%, Risk 10%, Quality 5%, ML 25%
      Sub-metrics emphasise daily price action, volume spikes, RSI/Stochastic.

    **long** — Buy-and-hold (months to years):
      Momentum 7%, Technical 8%, Fundamental 35%, Risk 15%, Quality 22%, ML 13%
      Sub-metrics emphasise PEG/forward-PE, SMA200, 52-week position, earnings quality.

    **balanced** (default) — Medium-term position trading:
      Momentum 15%, Technical 20%, Fundamental 25%, Risk 12%, Quality 10%, ML 18%

    Includes rank_tier (Strong Buy → Sell) and conviction level (High/Medium/Low)
    based on dimensional agreement.

    Results cached 10 min server-side per horizon.
    """
    if horizon not in ("short", "long", "balanced"):
        horizon = "balanced"

    now = time.time()

    # ── Per-horizon scored cache ────────────────────────────────────────
    hcache = _cache[horizon]
    cache_age = now - hcache["ts"]

    if hcache["data"] is not None and cache_age < CACHE_TTL_SECONDS:
        all_scores: list[StockScore] = hcache["data"]
        filtered = sorted(
            [s for s in all_scores if s.composite_score >= min_score],
            key=lambda s: s.composite_score,
            reverse=True,
        )
        return RankingResponse(
            stocks=filtered[:limit],
            has_stale_data=any(not s.data_fresh for s in all_scores),
            has_ml_data=any(s.has_ml_data for s in all_scores),
            total_scored=len(all_scores),
            horizon=horizon,
            cached=True,
            cache_age_seconds=round(cache_age, 1),
        )

    # ── Raw snapshots cache (shared across horizons) ────────────────────
    snap_age = now - _snapshots_cache["ts"]
    if _snapshots_cache["data"] is not None and snap_age < CACHE_TTL_SECONDS:
        snapshots: list[dict] = _snapshots_cache["data"]
    else:
        client = _get_supabase_client()
        try:
            result = (
                client.table("stock_snapshots")
                .select("*")
                .order("updated_at", desc=True)
                .limit(500)
                .execute()
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Supabase query failed: {exc}") from exc

        snapshots = result.data or []
        _snapshots_cache["data"] = snapshots
        _snapshots_cache["ts"] = time.time()

    if not snapshots:
        return RankingResponse(
            stocks=[],
            has_stale_data=False,
            has_ml_data=False,
            total_scored=0,
            horizon=horizon,
            cached=False,
            cache_age_seconds=0.0,
        )

    all_scores = _compute_scores(snapshots, horizon=horizon)
    hcache["data"] = all_scores
    hcache["ts"] = time.time()

    filtered = sorted(
        [s for s in all_scores if s.composite_score >= min_score],
        key=lambda s: s.composite_score,
        reverse=True,
    )
    return RankingResponse(
        stocks=filtered[:limit],
        has_stale_data=any(not s.data_fresh for s in all_scores),
        has_ml_data=any(s.has_ml_data for s in all_scores),
        total_scored=len(all_scores),
        horizon=horizon,
        cached=False,
        cache_age_seconds=0.0,
    )
