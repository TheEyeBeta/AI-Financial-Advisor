"""
Trade Engine API routes.

These endpoints provide AI context data that would normally come from a live Trade Engine.
Since the Trade Engine may not be deployed, these return stub/empty data so the frontend
doesn't error out. The frontend will fall back to Supabase data when this returns empty.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
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
    """Status of the Trade Engine - matches TradeEngineEngineStatus interface."""
    is_running: bool = False
    engine_started_at: Optional[str] = None
    last_price_tick: Optional[str] = None
    last_news_poll: Optional[str] = None
    total_ticks_processed: int = 0
    total_news_fetched: int = 0
    active_workers: Dict[str, bool] = {}


class EngineSummaryFull(BaseModel):
    """Full summary matching frontend TradeEngineAIContext.summary interface."""
    # Coverage metrics
    total_tracked_tickers: int = 0
    tickers_with_data: int = 0
    tickers_with_indicators: Optional[int] = None
    tickers_with_fundamentals: Optional[int] = None
    
    # Signal counts
    buy_signals_count: int = 0
    sell_signals_count: int = 0
    hold_signals_count: int = 0
    tickers_with_buy: List[str] = []
    tickers_with_sell: List[str] = []
    
    # Market health indicators
    average_rsi: Optional[float] = None
    average_pe_ratio: Optional[float] = None
    bullish_tickers: Optional[int] = None
    bearish_tickers: Optional[int] = None
    oversold_tickers: Optional[int] = None
    overbought_tickers: Optional[int] = None
    high_volume_tickers: Optional[List[str]] = None
    signals_last_24h: int = 0
    news_count: int = 0


class NewsItemFull(BaseModel):
    """News item matching frontend interface."""
    headline: str
    source: Optional[str] = None
    category: Optional[str] = None
    published_at: str
    related_tickers: Optional[str] = None


class AIContextResponse(BaseModel):
    """Full AI context response matching frontend TradeEngineAIContext interface."""
    generated_at: str
    engine_status: EngineStatus
    tracked_tickers: List[str] = []
    ticker_snapshots: List[TickerSnapshot] = []
    recent_signals: List[TradingSignal] = []
    recent_news: List[NewsItemFull] = []
    summary: EngineSummaryFull


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
        generated_at=datetime.now(timezone.utc).isoformat(),
        engine_status=EngineStatus(
            is_running=False,
            engine_started_at=None,
            last_price_tick=None,
            last_news_poll=None,
            total_ticks_processed=0,
            total_news_fetched=0,
            active_workers={},
        ),
        tracked_tickers=[],
        ticker_snapshots=[],
        recent_signals=[],
        recent_news=[],
        summary=EngineSummaryFull(
            total_tracked_tickers=0,
            tickers_with_data=0,
            buy_signals_count=0,
            sell_signals_count=0,
            hold_signals_count=0,
            tickers_with_buy=[],
            tickers_with_sell=[],
            signals_last_24h=0,
            news_count=0,
        ),
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


def _get_supabase_client():
    """Lazy-init Supabase client using either prefixed or plain env vars."""
    url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        return None
    from supabase import create_client
    return create_client(url, key)


@router.get("/api/stock-price/{ticker}")
async def get_stock_price(ticker: str) -> Dict[str, Any]:
    """
    Return the last known price for a ticker from stock_snapshots.

    Falls back gracefully when Supabase is unavailable or the ticker is not found.
    """
    ticker = ticker.upper()
    client = _get_supabase_client()
    if client:
        try:
            result = (
                client.table("stock_snapshots")
                .select("ticker,last_price,price_change_pct,updated_at")
                .eq("ticker", ticker)
                .limit(1)
                .execute()
            )
            if result.data:
                row = result.data[0]
                return {
                    "ticker": ticker,
                    "price": row.get("last_price"),
                    "change_percent": row.get("price_change_pct"),
                    "updated_at": row.get("updated_at"),
                    "source": "supabase",
                }
        except Exception:
            pass

    # Ticker not found or Supabase unavailable — return null price so the
    # frontend can handle it gracefully instead of getting a 404.
    return {"ticker": ticker, "price": None, "change_percent": None, "source": "unavailable"}


@router.websocket("/ws/live")
async def websocket_live(websocket: WebSocket) -> None:
    """
    WebSocket endpoint matching the TradeEngineWebSocket frontend client.

    Supports: subscribe, unsubscribe, get_subscriptions, ping.
    No live price streaming — sends engine_status on connect so the
    frontend knows the engine is in stub mode.
    """
    await websocket.accept()
    connection_id = str(uuid.uuid4())
    subscriptions: set[str] = set()

    await websocket.send_json({
        "type": "connected",
        "connection_id": connection_id,
        "message": "Connected (stub mode — Trade Engine not deployed)",
    })
    await websocket.send_json({
        "type": "engine_status",
        "is_operational": False,
        "is_halted": False,
        "halt_reason": "Trade Engine not deployed",
        "workers": {"price": False, "news": False, "algorithm": False},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            action = data.get("action")

            if action == "ping":
                await websocket.send_json({"type": "pong", "timestamp": data.get("timestamp", 0)})

            elif action == "subscribe":
                tickers = [t.upper() for t in data.get("tickers", [])]
                subscriptions.update(tickers)
                await websocket.send_json({
                    "type": "subscribed",
                    "tickers": tickers,
                    "message": f"Subscribed to {len(tickers)} ticker(s) (stub — no live data)",
                })

            elif action == "unsubscribe":
                tickers = [t.upper() for t in data.get("tickers", [])]
                subscriptions.difference_update(tickers)
                await websocket.send_json({
                    "type": "unsubscribed",
                    "tickers": tickers,
                    "message": f"Unsubscribed from {len(tickers)} ticker(s)",
                })

            elif action == "get_subscriptions":
                ticker_list = list(subscriptions)
                await websocket.send_json({
                    "type": "subscriptions",
                    "tickers": ticker_list,
                    "count": len(ticker_list),
                })

            else:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Unknown action: {action!r}",
                    "supported_actions": ["subscribe", "unsubscribe", "get_subscriptions", "ping"],
                })

    except WebSocketDisconnect:
        pass
