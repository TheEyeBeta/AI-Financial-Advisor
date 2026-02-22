"""
Trade Engine API routes.

These endpoints provide AI context data that would normally come from a live Trade Engine.
Since the Trade Engine may not be deployed, these return stub/empty data so the frontend
doesn't error out. The frontend will fall back to Supabase data when this returns empty.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel


router = APIRouter(tags=["trade-engine"])


class TickerSnapshot(BaseModel):
    """Snapshot of a single ticker's data."""
    ticker: str
    company_name: Optional[str] = None
    last_price: Optional[float] = None
    price_change_pct: Optional[float] = None
    volume: Optional[int] = None
    volume_ratio: Optional[float] = None
    rsi_14: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_histogram: Optional[float] = None
    pe_ratio: Optional[float] = None
    market_cap: Optional[float] = None
    latest_signal: Optional[str] = None
    signal_confidence: Optional[float] = None
    signal_timestamp: Optional[str] = None
    signal_strategy: Optional[str] = None
    is_bullish: Optional[bool] = None


class TradingSignal(BaseModel):
    """A trading signal from the engine."""
    ticker: str
    signal: str
    strategy: str
    confidence: Optional[float] = None
    timestamp: str
    price_at_signal: Optional[float] = None


class NewsItem(BaseModel):
    """A news article."""
    headline: str
    source: Optional[str] = None
    url: Optional[str] = None
    published_at: Optional[str] = None
    related_tickers: Optional[str] = None
    sentiment: Optional[str] = None


class EngineSummary(BaseModel):
    """Summary statistics from the engine."""
    total_tracked_tickers: int = 0
    tickers_with_data: int = 0
    tickers_with_indicators: Optional[int] = None
    tickers_with_fundamentals: Optional[int] = None
    average_rsi: Optional[float] = None
    average_pe_ratio: Optional[float] = None
    bullish_tickers: Optional[int] = None
    bearish_tickers: Optional[int] = None
    oversold_tickers: Optional[int] = None
    overbought_tickers: Optional[int] = None
    high_volume_tickers: Optional[List[str]] = None
    signals_last_24h: int = 0
    news_count: int = 0


class EngineStatus(BaseModel):
    """Status of the Trade Engine."""
    connected: bool
    last_update: Optional[str] = None
    data_freshness: str = "unknown"
    engine_version: Optional[str] = None


class AIContextResponse(BaseModel):
    """Full AI context response matching frontend expectations."""
    status: EngineStatus
    summary: EngineSummary
    tracked_tickers: List[str] = []
    ticker_snapshots: List[TickerSnapshot] = []
    recent_signals: List[TradingSignal] = []
    recent_news: List[NewsItem] = []


@router.get("/api/v1/ai/context")
async def get_ai_context(
    include_news: bool = Query(True, description="Include recent news articles"),
    news_limit: int = Query(15, ge=1, le=100, description="Maximum news articles to return"),
    signals_hours: int = Query(48, ge=1, le=168, description="Hours of signal history to include"),
) -> AIContextResponse:
    """
    Get comprehensive AI context for the chatbot.
    
    This endpoint provides market data context for AI responses.
    When the Trade Engine is not deployed, returns empty/stub data
    and the frontend falls back to Supabase data.
    
    Note: This is a stub endpoint. In production with a live Trade Engine,
    this would return real market data, signals, and news.
    """
    # Return stub response - Trade Engine not deployed
    # Frontend will use Supabase fallback for actual data
    return AIContextResponse(
        status=EngineStatus(
            connected=False,
            last_update=None,
            data_freshness="unavailable",
            engine_version="stub-1.0.0",
        ),
        summary=EngineSummary(
            total_tracked_tickers=0,
            tickers_with_data=0,
            signals_last_24h=0,
            news_count=0,
        ),
        tracked_tickers=[],
        ticker_snapshots=[],
        recent_signals=[],
        recent_news=[],
    )


@router.get("/api/v1/ai/signals")
async def get_signals(
    ticker: Optional[str] = Query(None, description="Filter by ticker symbol"),
    signal_type: Optional[str] = Query(None, description="Filter by signal type (BUY, SELL, HOLD)"),
    hours: int = Query(24, ge=1, le=168, description="Hours of history to include"),
    limit: int = Query(50, ge=1, le=500, description="Maximum signals to return"),
) -> List[TradingSignal]:
    """
    Get recent trading signals.
    
    This endpoint provides trading signals from the Trade Engine.
    When the Trade Engine is not deployed, returns empty list
    and the frontend handles gracefully.
    """
    # Return empty list - Trade Engine not deployed
    return []


@router.get("/api/v1/engine/status")
async def get_engine_status() -> Dict[str, Any]:
    """
    Get Trade Engine connection status.
    
    Returns the current status of the Trade Engine connection.
    """
    return {
        "connected": False,
        "message": "Trade Engine not deployed. Using Supabase data fallback.",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
