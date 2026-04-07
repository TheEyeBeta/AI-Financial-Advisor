"""
Stock Ranking API routes.

GET /api/stocks/ranking
GET /api/stocks/detail/{ticker}

Pure read endpoints — return pre-computed top stocks from market.trending_stocks
and live snapshot data from market.stock_snapshots.
Scores are computed once daily at 01:00 UTC by the background ranking engine
(services/ranking_engine.py).  No computation is performed here.

Env vars:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel

from ..services.auth import AuthenticatedUser, optional_auth
from ..services.supabase_client import supabase_client
from ..services.rate_limit import RateLimitConfig, rate_limiter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["stock-ranking"])

ANONYMOUS_RATE_LIMIT = RateLimitConfig(
    requests_per_minute=10,
    requests_per_hour=600,
    requests_per_day=14400,
)
AUTHENTICATED_RATE_LIMIT = RateLimitConfig(
    requests_per_minute=60,
    requests_per_hour=3600,
    requests_per_day=86400,
    suspicious_request_threshold=120,
)


# ── Pydantic models ───────────────────────────────────────────────────────────

class TrendingStock(BaseModel):
    ticker: str
    symbol: Optional[str] = None
    name: Optional[str] = None
    change_percent: Optional[float] = None
    composite_score: float
    # ── Indicator-based sub-scores (new composite formula) ────────────────────
    trend_score: Optional[float] = None       # 30% weight: price vs SMA50/200
    momentum_score: Optional[float] = None    # 30% weight: RSI + MACD histogram
    volume_score: Optional[float] = None      # 20% weight: volume / avg_volume_10d
    range_score: Optional[float] = None       # 10% weight: 52-week position
    adx_score: Optional[float] = None         # 10% weight: ADX (bullish only)
    # ── Legacy dimension scores (kept for backwards compatibility) ─────────────
    technical_score: Optional[float] = None
    fundamental_score: Optional[float] = None
    consistency_score: Optional[float] = None
    signal_score: Optional[float] = None
    momentum_1m: Optional[float] = None
    momentum_3m: Optional[float] = None
    momentum_6m: Optional[float] = None
    momentum_12m: Optional[float] = None
    fundamental_trend: Optional[str] = None
    rank_tier: Optional[str] = None
    conviction: Optional[str] = None
    ranked_at: Optional[str] = None
    updated_at: Optional[str] = None


class RankingResponse(BaseModel):
    stocks: list[TrendingStock]
    total: int
    last_ranked_at: Optional[str] = None
    data_age_hours: Optional[float] = None


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/api/stocks/ranking", response_model=RankingResponse)
async def get_stock_ranking(
    raw_request: Request,
    response: Response,
    limit: int = Query(
        default=50, ge=1, le=50,
        description="Number of top stocks to return (max 50)",
    ),
    min_score: float = Query(
        default=0.0, ge=0.0, le=100.0,
        description="Minimum composite_score filter",
    ),
    rank_tier: Optional[str] = Query(
        default=None,
        description="Filter by rank tier: 'Strong Buy', 'Buy', 'Hold', 'Underperform', 'Sell'",
    ),
    auth_user: Optional[AuthenticatedUser] = Depends(optional_auth),
) -> RankingResponse:
    """
    Return the pre-computed top stocks from market.trending_stocks.

    Scores are refreshed once daily at 01:00 UTC by the background ranking
    engine.  `data_age_hours` tells you how fresh the data is.

    Filters:
    - `min_score`: only return stocks with composite_score >= this value
    - `rank_tier`: only return stocks matching this tier label
    """
    verified_user_id = auth_user.auth_id if auth_user else None
    rate_limit_config = AUTHENTICATED_RATE_LIMIT if verified_user_id else ANONYMOUS_RATE_LIMIT

    allowed, error_msg, rate_limit_info = rate_limiter.check_rate_limit(
        raw_request,
        "/api/stocks/ranking",
        user_id=verified_user_id,
        estimated_tokens=0,
        config_override=rate_limit_config,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail=error_msg or "Rate limit exceeded")
    rate_limiter.add_rate_limit_headers(response, rate_limit_info)

    try:
        try:
            query = (
                supabase_client.schema("market")
                .table("trending_stocks")
                .select("*")
                .order("composite_score", desc=True)
                .limit(50)  # table always has ≤50 rows; fetch all, slice below
            )

            if min_score > 0:
                query = query.gte("composite_score", min_score)

            if rank_tier:
                query = query.eq("rank_tier", rank_tier)

            result = query.execute()
            rows = result.data or []
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to read trending stocks: {exc}",
            ) from exc

        # Compute data age from the most recent ranked_at
        last_ranked_at: Optional[str] = None
        data_age_hours: Optional[float] = None

        if rows:
            ranked_at_str = rows[0].get("ranked_at")
            if ranked_at_str:
                last_ranked_at = ranked_at_str
                try:
                    ranked_dt = datetime.fromisoformat(
                        ranked_at_str.replace("Z", "+00:00")
                    )
                    now = datetime.now(timezone.utc)
                    data_age_hours = round(
                        (now - ranked_dt).total_seconds() / 3600, 1
                    )
                except Exception:
                    pass

        stocks = [TrendingStock(**row) for row in rows[:limit]]

        return RankingResponse(
            stocks=stocks,
            total=len(rows),
            last_ranked_at=last_ranked_at,
            data_age_hours=data_age_hours,
        )
    finally:
        rate_limiter.release_request(raw_request, user_id=verified_user_id)


# ── Detail endpoint models ─────────────────────────────────────────────────────

class TechnicalIndicators(BaseModel):
    rsi_14: Optional[float] = None
    rsi_9: Optional[float] = None
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_histogram: Optional[float] = None
    macd_above_signal: Optional[bool] = None
    adx: Optional[float] = None
    stochastic_k: Optional[float] = None
    stochastic_d: Optional[float] = None
    williams_r: Optional[float] = None
    cci: Optional[float] = None
    bollinger_upper: Optional[float] = None
    bollinger_lower: Optional[float] = None
    bollinger_position: Optional[int] = None
    golden_cross: Optional[bool] = None


class FundamentalsData(BaseModel):
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


class SignalsData(BaseModel):
    is_bullish: Optional[bool] = None
    is_oversold: Optional[bool] = None
    is_overbought: Optional[bool] = None
    latest_signal: Optional[str] = None
    signal_strategy: Optional[str] = None
    signal_confidence: Optional[float] = None


class RankingData(BaseModel):
    composite_score: Optional[float] = None
    smoothed_score: Optional[float] = None
    rank_tier: Optional[str] = None
    conviction: Optional[str] = None
    dimension_scores: dict = {}


class StockDetailResponse(BaseModel):
    ticker: str
    company_name: Optional[str] = None
    last_price: Optional[float] = None
    price_change_pct: Optional[float] = None
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    volume: Optional[int] = None
    avg_volume_10d: Optional[float] = None
    volume_ratio: Optional[float] = None
    price_vs_sma_50: Optional[float] = None
    price_vs_sma_200: Optional[float] = None
    high_52w_position: Optional[int] = None
    technicals: TechnicalIndicators
    fundamentals: FundamentalsData
    signals: SignalsData
    ranking: Optional[RankingData] = None


# ── Detail endpoint ────────────────────────────────────────────────────────────

@router.get("/api/stocks/detail/{ticker}", response_model=StockDetailResponse)
async def get_stock_detail(
    ticker: str,
    raw_request: Request,
    response: Response,
    auth_user: Optional[AuthenticatedUser] = Depends(optional_auth),
) -> StockDetailResponse:
    """
    Return live snapshot data for a single ticker from market.stock_snapshots,
    combined with the most recent balanced-horizon ranking row.

    Returns 404 if the ticker is not found in stock_snapshots.
    Returns ranking: null if no ranking history exists for the ticker.
    """
    verified_user_id = auth_user.auth_id if auth_user else None
    rate_limit_config = AUTHENTICATED_RATE_LIMIT if verified_user_id else ANONYMOUS_RATE_LIMIT

    allowed, error_msg, rate_limit_info = rate_limiter.check_rate_limit(
        raw_request,
        "/api/stocks/detail",
        user_id=verified_user_id,
        estimated_tokens=0,
        config_override=rate_limit_config,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail=error_msg or "Rate limit exceeded")
    rate_limiter.add_rate_limit_headers(response, rate_limit_info)

    try:
        ticker_upper = ticker.upper()

        # ── Query stock_snapshots ──────────────────────────────────────────────
        try:
            snap_result = (
                supabase_client.schema("market")
                .table("stock_snapshots")
                .select("*")
                .eq("ticker", ticker_upper)
                .limit(1)
                .execute()
            )
            snap_rows = snap_result.data or []
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to read stock snapshot: {exc}",
            ) from exc

        if not snap_rows:
            raise HTTPException(
                status_code=404,
                detail=f"No snapshot data found for ticker '{ticker_upper}'",
            )

        snap = snap_rows[0]

        # ── Query stock_ranking_history (best-effort, do not fail the request) ─
        ranking_data: Optional[RankingData] = None
        try:
            rank_result = (
                supabase_client.schema("market")
                .table("stock_ranking_history")
                .select("*")
                .eq("ticker", ticker_upper)
                .eq("horizon", "balanced")
                .order("scored_at", desc=True)
                .limit(1)
                .execute()
            )
            rank_rows = rank_result.data or []
            if rank_rows:
                r = rank_rows[0]
                ranking_data = RankingData(
                    composite_score=r.get("composite_score"),
                    smoothed_score=r.get("smoothed_score"),
                    rank_tier=r.get("rank_tier"),
                    conviction=r.get("conviction"),
                    dimension_scores=r.get("dimension_scores") or {},
                )
        except Exception:
            pass  # ranking history is optional

        # ── Compute derived fields server-side ─────────────────────────────────
        last_price: Optional[float] = snap.get("last_price")
        sma_50: Optional[float] = snap.get("sma_50")
        sma_200: Optional[float] = snap.get("sma_200")
        macd: Optional[float] = snap.get("macd")
        macd_signal_val: Optional[float] = snap.get("macd_signal")
        bollinger_upper: Optional[float] = snap.get("bollinger_upper")
        bollinger_lower: Optional[float] = snap.get("bollinger_lower")
        high_52w: Optional[float] = snap.get("high_52w")
        low_52w: Optional[float] = snap.get("low_52w")

        # golden_cross: sma_50 > sma_200
        golden_cross: Optional[bool] = None
        if sma_50 is not None and sma_200 is not None:
            golden_cross = sma_50 > sma_200

        # macd_above_signal: macd > macd_signal
        macd_above_signal: Optional[bool] = None
        if macd is not None and macd_signal_val is not None:
            macd_above_signal = macd > macd_signal_val

        # bollinger_position: ((price - lower) / (upper - lower)) * 100, 0dp
        bollinger_position: Optional[int] = None
        if bollinger_upper is not None and bollinger_lower is not None and last_price is not None:
            denom = bollinger_upper - bollinger_lower
            bollinger_position = 50 if denom == 0 else round(((last_price - bollinger_lower) / denom) * 100)

        # high_52w_position: ((price - low) / (high - low)) * 100, 0dp
        high_52w_position: Optional[int] = None
        if high_52w is not None and low_52w is not None and last_price is not None:
            denom = high_52w - low_52w
            high_52w_position = 50 if denom == 0 else round(((last_price - low_52w) / denom) * 100)

        return StockDetailResponse(
            ticker=ticker_upper,
            company_name=snap.get("company_name"),
            last_price=last_price,
            price_change_pct=snap.get("price_change_pct"),
            high_52w=high_52w,
            low_52w=low_52w,
            volume=snap.get("volume"),
            avg_volume_10d=snap.get("avg_volume_10d"),
            volume_ratio=snap.get("volume_ratio"),
            price_vs_sma_50=snap.get("price_vs_sma_50"),
            price_vs_sma_200=snap.get("price_vs_sma_200"),
            high_52w_position=high_52w_position,
            technicals=TechnicalIndicators(
                rsi_14=snap.get("rsi_14"),
                rsi_9=snap.get("rsi_9"),
                macd=macd,
                macd_signal=macd_signal_val,
                macd_histogram=snap.get("macd_histogram"),
                macd_above_signal=macd_above_signal,
                adx=snap.get("adx"),
                stochastic_k=snap.get("stochastic_k"),
                stochastic_d=snap.get("stochastic_d"),
                williams_r=snap.get("williams_r"),
                cci=snap.get("cci"),
                bollinger_upper=bollinger_upper,
                bollinger_lower=bollinger_lower,
                bollinger_position=bollinger_position,
                golden_cross=golden_cross,
            ),
            fundamentals=FundamentalsData(
                pe_ratio=snap.get("pe_ratio"),
                forward_pe=snap.get("forward_pe"),
                peg_ratio=snap.get("peg_ratio"),
                price_to_book=snap.get("price_to_book"),
                price_to_sales=snap.get("price_to_sales"),
                eps=snap.get("eps"),
                eps_growth=snap.get("eps_growth"),
                revenue_growth=snap.get("revenue_growth"),
                dividend_yield=snap.get("dividend_yield"),
                market_cap=snap.get("market_cap"),
            ),
            signals=SignalsData(
                is_bullish=snap.get("is_bullish"),
                is_oversold=snap.get("is_oversold"),
                is_overbought=snap.get("is_overbought"),
                latest_signal=snap.get("latest_signal"),
                signal_strategy=snap.get("signal_strategy"),
                signal_confidence=snap.get("signal_confidence"),
            ),
            ranking=ranking_data,
        )
    finally:
        rate_limiter.release_request(raw_request, user_id=verified_user_id)
