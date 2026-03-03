"""
Stock Ranking API route.

GET /api/stocks/ranking

Fetches stock_snapshots from Supabase, computes composite scores across 4
dimensions (Momentum, Technical, Fundamental, ML Signal), and returns a
ranked list.  Results are cached in-memory for CACHE_TTL_SECONDS so repeated
requests within the window are served instantly without hitting Supabase.

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

_cache: dict[str, Any] = {"data": None, "ts": 0.0}


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
    rsi_14: Optional[float] = None
    macd_above_signal: Optional[bool] = None
    golden_cross: Optional[bool] = None
    volume_ratio: Optional[float] = None
    pe_ratio: Optional[float] = None
    eps_growth: Optional[float] = None
    revenue_growth: Optional[float] = None
    signal_confidence: Optional[float] = None
    is_bullish: Optional[bool] = None


class StockScore(BaseModel):
    ticker: str
    company_name: Optional[str] = None
    last_price: Optional[float] = None
    price_change_pct: Optional[float] = None
    updated_at: Optional[str] = None
    composite_score: float
    momentum_score: float
    technical_score: float
    fundamental_score: float
    ml_score: Optional[float] = None
    has_ml_data: bool
    breakdown: ScoreBreakdown
    data_fresh: bool


class RankingResponse(BaseModel):
    stocks: list[StockScore]
    has_stale_data: bool
    has_ml_data: bool
    total_scored: int
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
        score = 50.0 if rng == 0 else (val - lo) / rng * 100.0
        if lower_better:
            score = 100.0 - score
        result[ticker] = round(score, 1)
    return result


def _rsi_score(rsi: Optional[float]) -> float:
    """Bell-curve score: 100 at RSI 50-70, decays to 0 at RSI 30 or 90."""
    if rsi is None or not math.isfinite(rsi):
        return 50.0
    if 50.0 <= rsi <= 70.0:
        return 100.0
    if rsi < 50.0:
        return max(0.0, (rsi - 30.0) / 20.0 * 100.0)
    return max(0.0, (90.0 - rsi) / 20.0 * 100.0)


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


def _vol_ratio(s: dict) -> Optional[float]:
    vr = _f(s.get("volume_ratio"))
    if vr is not None:
        return vr
    vol = _f(s.get("volume"))
    avg = _f(s.get("avg_volume_10d"))
    if vol is not None and avg is not None and avg > 0:
        return vol / avg
    return None


def _macd_diff(s: dict) -> Optional[float]:
    m = _f(s.get("macd"))
    sig = _f(s.get("macd_signal"))
    if m is None or sig is None:
        return None
    return m - sig


def _golden_cross_ratio(s: dict) -> Optional[float]:
    sma50 = _f(s.get("sma_50"))
    sma200 = _f(s.get("sma_200"))
    if sma50 is None or sma200 is None or sma200 == 0:
        return None
    return (sma50 / sma200 - 1.0) * 100.0


def _compute_scores(snapshots: list[dict]) -> list[StockScore]:
    stale_cutoff = time.time() - 86400  # 24 h

    # Normalized maps for each metric
    pc_map = _normalize(snapshots, lambda s: _f(s.get("price_change_pct")))
    sma50_map = _normalize(snapshots, lambda s: _f(s.get("price_vs_sma_50")))
    vr_map = _normalize(snapshots, _vol_ratio)
    macd_map = _normalize(snapshots, _macd_diff)
    gc_map = _normalize(snapshots, _golden_cross_ratio)
    pe_map = _normalize(snapshots, lambda s: _f(s.get("pe_ratio")), lower_better=True, clamp_min=5, clamp_max=80)
    eps_map = _normalize(snapshots, lambda s: _f(s.get("eps_growth")), clamp_min=-50, clamp_max=200)
    rev_map = _normalize(snapshots, lambda s: _f(s.get("revenue_growth")), clamp_min=-30, clamp_max=100)

    def get(m: dict, ticker: str) -> float:
        return m.get(ticker, 50.0)

    out: list[StockScore] = []
    for s in snapshots:
        t = s["ticker"]

        momentum = (
            get(pc_map, t) * 0.40
            + get(sma50_map, t) * 0.35
            + get(vr_map, t) * 0.25
        )
        technical = (
            _rsi_score(_f(s.get("rsi_14"))) * 0.40
            + get(macd_map, t) * 0.35
            + get(gc_map, t) * 0.25
        )
        fundamental = (
            get(pe_map, t) * 0.35
            + get(eps_map, t) * 0.40
            + get(rev_map, t) * 0.25
        )
        ml_raw = _ml_score(s)
        has_ml = ml_raw is not None

        if has_ml:
            composite = momentum * 0.25 + technical * 0.30 + fundamental * 0.25 + ml_raw * 0.20  # type: ignore[operator]
        else:
            composite = momentum * (0.25 / 0.80) + technical * (0.30 / 0.80) + fundamental * (0.25 / 0.80)

        # Breakdown detail values
        vr_detail = _vol_ratio(s)
        macd_f = _f(s.get("macd"))
        macd_sig_f = _f(s.get("macd_signal"))
        macd_above = (macd_f > macd_sig_f) if macd_f is not None and macd_sig_f is not None else None
        sma50 = _f(s.get("sma_50"))
        sma200 = _f(s.get("sma_200"))
        golden = (sma50 > sma200) if sma50 is not None and sma200 is not None else None

        # Freshness
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
            momentum_score=round(momentum, 1),
            technical_score=round(technical, 1),
            fundamental_score=round(fundamental, 1),
            ml_score=round(ml_raw, 1) if has_ml else None,
            has_ml_data=has_ml,
            breakdown=ScoreBreakdown(
                rsi_14=_f(s.get("rsi_14")),
                macd_above_signal=macd_above,
                golden_cross=golden,
                volume_ratio=vr_detail,
                pe_ratio=_f(s.get("pe_ratio")),
                eps_growth=_f(s.get("eps_growth")),
                revenue_growth=_f(s.get("revenue_growth")),
                signal_confidence=_f(s.get("signal_confidence")),
                is_bullish=s.get("is_bullish"),
            ),
            data_fresh=data_fresh,
        ))
    return out


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/api/stocks/ranking", response_model=RankingResponse)
async def get_stock_ranking(
    limit: int = Query(default=20, ge=1, le=100, description="Top N stocks to return"),
    min_score: float = Query(default=0.0, ge=0, le=100, description="Minimum composite score filter"),
) -> RankingResponse:
    """
    Return stocks ranked by composite score (0-100).

    Scoring dimensions (all min-max normalized across the universe):
    - Momentum 25%: price_change_pct, price_vs_sma_50, volume_ratio
    - Technical 30%: RSI sweet-spot (50-70), MACD diff, SMA50/SMA200 golden cross
    - Fundamental 25%: P/E inverted, EPS growth, revenue growth
    - ML Signal 20%: signal_confidence × is_bullish direction (redistributed if unavailable)

    Results cached 10 min server-side.
    """
    now = time.time()
    cache_age = now - _cache["ts"]

    # Serve from cache if still fresh
    if _cache["data"] is not None and cache_age < CACHE_TTL_SECONDS:
        all_scores: list[StockScore] = _cache["data"]
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
            cached=True,
            cache_age_seconds=round(cache_age, 1),
        )

    # Cache miss — query Supabase
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

    snapshots: list[dict] = result.data or []
    if not snapshots:
        return RankingResponse(
            stocks=[],
            has_stale_data=False,
            has_ml_data=False,
            total_scored=0,
            cached=False,
            cache_age_seconds=0.0,
        )

    all_scores = _compute_scores(snapshots)
    _cache["data"] = all_scores
    _cache["ts"] = time.time()

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
        cached=False,
        cache_age_seconds=0.0,
    )
