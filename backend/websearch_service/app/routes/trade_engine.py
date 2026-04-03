"""
Trade Engine API routes.

These endpoints provide AI context data that would normally come from a live Trade Engine.
Since the Trade Engine may not be deployed, these return stub/empty data so the frontend
doesn't error out. The frontend will fall back to Supabase data when this returns empty.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..services.auth import (
    get_backend_anon_key,
    get_backend_service_role_key,
    get_backend_supabase_url,
    require_websocket_auth,
)
from ..services.dataapi_client import get_dataapi_client

logger = logging.getLogger(__name__)

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


async def _build_context_from_dataapi() -> AIContextResponse | None:
    """Try to build AI context from TheEyeBetaDataAPI. Returns None on failure."""
    client = get_dataapi_client()
    if not client.is_configured:
        return None
    try:
        ctx = await client.get_advisor_context(ticker_limit=50, news_limit=15)
        tickers_data = ctx.get("tickers", [])
        news_data = ctx.get("news", [])

        snapshots = []
        buy_tickers: list[str] = []
        sell_tickers: list[str] = []
        for t in tickers_data:
            snap = TickerSnapshot(
                ticker=t.get("ticker", ""),
                company_name=t.get("company_name"),
                last_price=t.get("last_price"),
                price_change_pct=t.get("price_change_pct"),
                volume=t.get("volume"),
                rsi_14=t.get("rsi_14"),
                sma_50=t.get("sma_50"),
                sma_200=t.get("sma_200"),
                macd=t.get("macd"),
                macd_signal=t.get("macd_signal"),
                pe_ratio=t.get("pe_ratio"),
                market_cap=t.get("market_cap"),
                latest_signal=t.get("latest_signal"),
                signal_confidence=t.get("signal_confidence"),
                is_bullish=t.get("is_bullish"),
            )
            snapshots.append(snap)
            sig = (t.get("latest_signal") or "").upper()
            if sig == "BUY":
                buy_tickers.append(snap.ticker)
            elif sig == "SELL":
                sell_tickers.append(snap.ticker)

        news_items = [
            NewsItemFull(
                headline=n.get("headline", ""),
                source=n.get("source"),
                category=n.get("category"),
                published_at=n.get("published_at", ""),
                related_tickers=n.get("related_tickers"),
            )
            for n in news_data
        ]

        # Also fetch signals
        signals_list: list[TradingSignal] = []
        try:
            sig_data = await client.get_latest_signals(limit=50)
            for s in sig_data.get("signals", []):
                signals_list.append(TradingSignal(
                    ticker=s.get("ticker", ""),
                    signal=s.get("signal", ""),
                    strategy=s.get("strategy_name", ""),
                    confidence=s.get("confidence"),
                    timestamp=s.get("timestamp", ""),
                    price_at_signal=s.get("entry_price"),
                ))
        except Exception:
            pass

        tracked = [s.ticker for s in snapshots]
        return AIContextResponse(
            generated_at=datetime.now(timezone.utc).isoformat(),
            engine_status=EngineStatus(
                is_running=True,
                engine_started_at=None,
                active_workers={"dataapi": True},
            ),
            tracked_tickers=tracked,
            ticker_snapshots=snapshots,
            recent_signals=signals_list,
            recent_news=news_items,
            summary=EngineSummaryFull(
                total_tracked_tickers=len(tracked),
                tickers_with_data=len(snapshots),
                buy_signals_count=len(buy_tickers),
                sell_signals_count=len(sell_tickers),
                hold_signals_count=0,
                tickers_with_buy=buy_tickers,
                tickers_with_sell=sell_tickers,
                signals_last_24h=len(signals_list),
                news_count=len(news_items),
            ),
        )
    except Exception as exc:
        logger.warning("DataAPI context fetch failed: %s", exc)
        return None


@router.get("/api/v1/ai/context")
async def get_ai_context(
    include_news: bool = Query(True, description="Include recent news articles"),
    news_limit: int = Query(15, ge=1, le=100, description="Maximum news articles to return"),
    signals_hours: int = Query(48, ge=1, le=168, description="Hours of signal history to include"),
    source: str = Query(default="supabase", description="Data source: supabase, dataapi, or auto"),
) -> AIContextResponse:
    """
    Get comprehensive AI context for the chatbot.

    Use `source=dataapi` to fetch from TheEyeBetaDataAPI (live engine data),
    `source=auto` to try DataAPI first with stub fallback, or `source=supabase`
    (default) for the original stub behavior.
    """
    # Try DataAPI if requested
    if source in ("dataapi", "auto"):
        result = await _build_context_from_dataapi()
        if result is not None:
            return result
        if source == "dataapi":
            # DataAPI was explicitly requested but failed — return error-aware stub
            return AIContextResponse(
                generated_at=datetime.now(timezone.utc).isoformat(),
                engine_status=EngineStatus(is_running=False, active_workers={"dataapi": False}),
                tracked_tickers=[],
                ticker_snapshots=[],
                recent_signals=[],
                recent_news=[],
                summary=EngineSummaryFull(),
            )

    # Default stub response (original behavior)
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
    source: str = Query(default="supabase", description="Data source: supabase, dataapi, or auto"),
) -> List[TradingSignal]:
    """
    Get recent trading signals.

    Use `source=dataapi` or `source=auto` to fetch from TheEyeBetaDataAPI.
    Default (supabase) returns empty list (Trade Engine not deployed).
    """
    if source in ("dataapi", "auto"):
        client = get_dataapi_client()
        if client.is_configured:
            try:
                data = await client.get_latest_signals(ticker=ticker, limit=limit)
                signals = []
                for s in data.get("signals", []):
                    sig = TradingSignal(
                        ticker=s.get("ticker", ""),
                        signal=s.get("signal", ""),
                        strategy=s.get("strategy_name", ""),
                        confidence=s.get("confidence"),
                        timestamp=s.get("timestamp", ""),
                        price_at_signal=s.get("entry_price"),
                    )
                    if signal_type and sig.signal.upper() != signal_type.upper():
                        continue
                    signals.append(sig)
                return signals
            except Exception as exc:
                logger.warning("DataAPI signals fetch failed: %s", exc)
                if source == "dataapi":
                    return []

    return []


@router.get("/api/v1/engine/status")
async def get_engine_status(
    source: str = Query(default="supabase", description="Data source: supabase, dataapi, or auto"),
) -> Dict[str, Any]:
    """
    Get Trade Engine / DataAPI connection status.
    """
    if source in ("dataapi", "auto"):
        client = get_dataapi_client()
        if client.is_configured:
            try:
                health = await client.check_health()
                return {
                    "connected": True,
                    "source": "dataapi",
                    "message": "Connected to TheEyeBetaDataAPI.",
                    "database": health.get("database", False),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            except Exception as exc:
                if source == "dataapi":
                    return {
                        "connected": False,
                        "source": "dataapi",
                        "message": f"DataAPI unreachable: {exc}",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }

    return {
        "connected": False,
        "source": "supabase",
        "message": "Using Supabase data.",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _query_stock_snapshots(client, columns: str = "*", limit: int | None = None, ticker: str | None = None):
    """Query stock snapshots from the market schema."""
    query = client.schema("market").from_("stock_snapshots").select(columns)
    if ticker:
        query = query.eq("ticker", ticker)
    if limit is not None:
        query = query.limit(limit)
    return query.execute()


def _get_supabase_client():
    """Lazy-init Supabase client using backend-only env vars."""
    url = get_backend_supabase_url()
    key = get_backend_service_role_key() or get_backend_anon_key()
    if not url or not key:
        return None
    from supabase import create_client
    return create_client(url, key)


@router.get("/api/stock-price/{ticker}")
async def get_stock_price(
    ticker: str,
    source: str = Query(default="supabase", description="Data source: supabase, dataapi, or auto"),
) -> Dict[str, Any]:
    """
    Return the last known price for a ticker.

    Uses Supabase by default. Set `source=dataapi` or `source=auto` to
    fetch from TheEyeBetaDataAPI.
    """
    ticker = ticker.upper()

    # Try DataAPI first if requested
    if source in ("dataapi", "auto"):
        dataapi = get_dataapi_client()
        if dataapi.is_configured:
            try:
                data = await dataapi.get_quotes([ticker])
                quotes = data.get("quotes", [])
                if quotes:
                    q = quotes[0]
                    return {
                        "ticker": ticker,
                        "price": q.get("last_price"),
                        "change_percent": q.get("price_change_pct"),
                        "updated_at": q.get("updated_at"),
                        "source": "dataapi",
                    }
            except Exception as exc:
                logger.warning("DataAPI price fetch failed for %s: %s", ticker, exc)
                if source == "dataapi":
                    return {"ticker": ticker, "price": None, "change_percent": None, "source": "dataapi_error"}

    # Supabase fallback (original behavior)
    sb_client = _get_supabase_client()
    if sb_client:
        try:
            result = _query_stock_snapshots(
                sb_client,
                columns="ticker,last_price,price_change_pct,updated_at",
                limit=1,
                ticker=ticker,
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

    return {"ticker": ticker, "price": None, "change_percent": None, "source": "unavailable"}


@router.websocket("/ws/live")
async def websocket_live(websocket: WebSocket) -> None:
    """
    WebSocket endpoint matching the TradeEngineWebSocket frontend client.

    Supports: subscribe, unsubscribe, get_subscriptions, ping.
    No live price streaming — sends engine_status on connect so the
    frontend knows the engine is in stub mode.
    """
    try:
        await require_websocket_auth(websocket)
    except HTTPException as exc:
        reason = exc.detail if isinstance(exc.detail, str) else "Authentication required."
        await websocket.close(code=4401, reason=reason[:123])
        return

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
