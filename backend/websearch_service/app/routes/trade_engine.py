"""
Trade Engine API routes.

Market and trade-engine endpoints return explicit availability metadata.
Silent stub/empty success responses are not used in production paths.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Path, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..services.auth import (
    AuthenticatedUser,
    get_backend_anon_key,
    get_backend_service_role_key,
    get_backend_supabase_url,
    require_auth,
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
    data_available: bool = False
    availability_status: str = "unavailable"
    data_source: Optional[str] = None
    as_of: Optional[str] = None
    reason_code: Optional[str] = None


def _availability_fields(
    *,
    data_available: bool,
    availability_status: str,
    data_source: Optional[str],
    as_of: Optional[str] = None,
    reason_code: Optional[str] = None,
) -> dict[str, Any]:
    return {
        "data_available": data_available,
        "availability_status": availability_status,
        "data_source": data_source,
        "as_of": as_of,
        "reason_code": reason_code,
    }


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
        except Exception as sig_exc:
            logger.warning("DataAPI signals fetch skipped during context build: %s", sig_exc)

        tracked = [s.ticker for s in snapshots]
        as_of = datetime.now(timezone.utc).isoformat()
        return AIContextResponse(
            generated_at=as_of,
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
            **_availability_fields(
                data_available=len(snapshots) > 0,
                availability_status="ok" if snapshots else "degraded",
                data_source="dataapi",
                as_of=as_of,
            ),
        )
    except Exception as exc:
        logger.warning("DataAPI context fetch failed: %s", exc)
        return None


def _build_context_from_supabase() -> AIContextResponse | None:
    """Build AI context from Supabase market snapshots. Returns None when unavailable."""
    sb_client = _get_supabase_client()
    if not sb_client:
        return None
    try:
        result = _query_stock_snapshots(
            sb_client,
            columns="ticker,company_name,last_price,price_change_pct,volume,rsi_14,sma_50,sma_200,macd,macd_signal,pe_ratio,market_cap,latest_signal,signal_confidence,updated_at",
            limit=50,
        )
        rows = result.data or []
        if not rows:
            return None

        snapshots: list[TickerSnapshot] = []
        buy_tickers: list[str] = []
        sell_tickers: list[str] = []
        latest_as_of: str | None = None
        for row in rows:
            snap = TickerSnapshot(
                ticker=row.get("ticker", ""),
                company_name=row.get("company_name"),
                last_price=row.get("last_price"),
                price_change_pct=row.get("price_change_pct"),
                volume=row.get("volume"),
                rsi_14=row.get("rsi_14"),
                sma_50=row.get("sma_50"),
                sma_200=row.get("sma_200"),
                macd=row.get("macd"),
                macd_signal=row.get("macd_signal"),
                pe_ratio=row.get("pe_ratio"),
                market_cap=row.get("market_cap"),
                latest_signal=row.get("latest_signal"),
                signal_confidence=row.get("signal_confidence"),
            )
            snapshots.append(snap)
            sig = (row.get("latest_signal") or "").upper()
            if sig == "BUY":
                buy_tickers.append(snap.ticker)
            elif sig == "SELL":
                sell_tickers.append(snap.ticker)
            updated_at = row.get("updated_at")
            if updated_at and (latest_as_of is None or str(updated_at) > latest_as_of):
                latest_as_of = str(updated_at)

        tracked = [s.ticker for s in snapshots]
        as_of = latest_as_of or datetime.now(timezone.utc).isoformat()
        return AIContextResponse(
            generated_at=datetime.now(timezone.utc).isoformat(),
            engine_status=EngineStatus(
                is_running=False,
                active_workers={"supabase": True},
            ),
            tracked_tickers=tracked,
            ticker_snapshots=snapshots,
            recent_signals=[],
            recent_news=[],
            summary=EngineSummaryFull(
                total_tracked_tickers=len(tracked),
                tickers_with_data=len(snapshots),
                buy_signals_count=len(buy_tickers),
                sell_signals_count=len(sell_tickers),
                hold_signals_count=0,
                tickers_with_buy=buy_tickers,
                tickers_with_sell=sell_tickers,
                signals_last_24h=0,
                news_count=0,
            ),
            **_availability_fields(
                data_available=True,
                availability_status="ok",
                data_source="supabase",
                as_of=as_of,
            ),
        )
    except Exception as exc:
        logger.warning("Supabase context fetch failed: %s", exc)
        return None


@router.get("/api/v1/ai/context")
async def get_ai_context(
    include_news: bool = Query(True, description="Include recent news articles"),
    news_limit: int = Query(15, ge=1, le=100, description="Maximum news articles to return"),
    signals_hours: int = Query(48, ge=1, le=168, description="Hours of signal history to include"),
    source: str = Query(default="auto", description="Data source: supabase, dataapi, or auto"),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> AIContextResponse:
    """
    Get comprehensive AI context for the chatbot.

  Use `source=dataapi` for live DataAPI data, `source=supabase` for cached
  market snapshots, or `source=auto` to try DataAPI then Supabase.
    """
    normalized_source = source.strip().lower()

    if normalized_source == "dataapi":
        result = await _build_context_from_dataapi()
        if result is not None and result.data_available:
            return result
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Market data provider is unavailable",
                "availability_status": "unavailable",
                "reason_code": "dataapi_unavailable",
                "data_source": "dataapi",
            },
        )

    if normalized_source == "supabase":
        result = _build_context_from_supabase()
        if result is not None:
            return result
        raise HTTPException(
            status_code=503,
            detail={
                "message": "No market snapshot data is available",
                "availability_status": "unavailable",
                "reason_code": "supabase_empty",
                "data_source": "supabase",
            },
        )

    # auto: DataAPI first, then Supabase
    result = await _build_context_from_dataapi()
    if result is not None and result.data_available:
        return result
    supabase_result = _build_context_from_supabase()
    if supabase_result is not None:
        return supabase_result

    raise HTTPException(
        status_code=503,
        detail={
            "message": "Market data is unavailable from all configured sources",
            "availability_status": "unavailable",
            "reason_code": "no_market_data",
            "data_source": None,
        },
    )


@router.get("/api/v1/ai/signals")
async def get_signals(
    ticker: Optional[str] = Query(None, description="Filter by ticker symbol"),
    signal_type: Optional[str] = Query(None, description="Filter by signal type (BUY, SELL, HOLD)"),
    hours: int = Query(24, ge=1, le=168, description="Hours of history to include"),
    limit: int = Query(50, ge=1, le=500, description="Maximum signals to return"),
    source: str = Query(default="auto", description="Data source: supabase, dataapi, or auto"),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> List[TradingSignal]:
    """
    Get recent trading signals.

    Use `source=dataapi` or `source=auto` to fetch from TheEyeBetaDataAPI.
    Returns 503 when no signal source is available.
    """
    normalized_source = source.strip().lower()
    if normalized_source in ("dataapi", "auto"):
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
                if normalized_source == "dataapi":
                    raise HTTPException(
                        status_code=502,
                        detail={
                            "message": "Trading signal provider failed",
                            "reason_code": "dataapi_error",
                        },
                    ) from exc

    raise HTTPException(
        status_code=503,
        detail={
            "message": "Trading signals are unavailable",
            "availability_status": "unavailable",
            "reason_code": "signals_not_configured",
        },
    )


@router.get("/api/v1/engine/status")
async def get_engine_status(
    source: str = Query(default="auto", description="Data source: supabase, dataapi, or auto"),
    _auth: AuthenticatedUser = Depends(require_auth),
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
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$", description="Ticker symbol (e.g. AAPL, BRK.B)"),
    source: str = Query(default="auto", description="Data source: supabase, dataapi, or auto"),
    _auth: AuthenticatedUser = Depends(require_auth),
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
                    raise HTTPException(
                        status_code=502,
                        detail={
                            "message": f"DataAPI price fetch failed for {ticker}",
                            "reason_code": "dataapi_error",
                        },
                    ) from exc

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
        except Exception as sb_exc:
            logger.warning("Supabase price fetch failed for %s: %s", ticker, sb_exc)

    raise HTTPException(
        status_code=404,
        detail={
            "message": f"No price data available for {ticker}",
            "availability_status": "unavailable",
            "reason_code": "price_not_found",
            "ticker": ticker,
        },
    )


@router.get("/api/v1/indicators/{ticker}/technical")
async def get_technical_indicators(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    date: Optional[str] = Query(None, description="Filter to a specific date (YYYY-MM-DD)"),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    """Latest technical indicators for a ticker, sourced from TheEyeBetaDataAPI."""
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            data = await client.get_technical_indicators(ticker, end=date, limit=1 if date else 1)
            rows = data.get("indicators", [])
            if rows:
                row = rows[-1]
                return {
                    "ticker": ticker,
                    "date": row.get("date", ""),
                    "sma_10": row.get("sma_10"),
                    "sma_50": row.get("sma_50"),
                    "sma_200": row.get("sma_200"),
                    "rsi_14": row.get("rsi_14"),
                    "macd": row.get("macd"),
                }
        except Exception as exc:
            logger.warning("DataAPI technical indicators failed for %s: %s", ticker, exc)
    raise HTTPException(status_code=404, detail=f"No indicator data for {ticker}")


@router.get("/api/v1/charting/{ticker}/prices")
async def get_charting_prices(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=2000),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> List[Dict[str, Any]]:
    """OHLCV price history for charting, sourced from TheEyeBetaDataAPI."""
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            data = await client.get_price_history(ticker, start=start_date, end=end_date, limit=limit)
            prices = data.get("prices", [])
            return [
                {
                    "date": p.get("date", ""),
                    "open": p.get("open"),
                    "high": p.get("high"),
                    "low": p.get("low"),
                    "close": p.get("close"),
                    "volume": p.get("volume"),
                }
                for p in prices
            ]
        except Exception as exc:
            logger.warning("DataAPI price history failed for %s: %s", ticker, exc)
    return []


@router.get("/api/v1/tickers")
async def get_tickers(
    active_only: bool = Query(True),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> List[Dict[str, Any]]:
    """List of tracked tickers, sourced from TheEyeBetaDataAPI advisor context."""
    client = get_dataapi_client()
    if client.is_configured:
        try:
            ctx = await client.get_advisor_context(ticker_limit=200, news_limit=0)
            tickers = ctx.get("tickers", [])
            return [
                {
                    "ticker_id": i,
                    "ticker": t.get("ticker", "") if isinstance(t, dict) else t,
                    "name": t.get("company_name", "") if isinstance(t, dict) else t,
                }
                for i, t in enumerate(tickers)
            ]
        except Exception as exc:
            logger.warning("DataAPI tickers list failed: %s", exc)
    return []


@router.get("/api/v1/ai/portfolio")
async def get_portfolio_summary(
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    """Market summary in portfolio-summary shape, sourced from TheEyeBetaDataAPI."""
    client = get_dataapi_client()
    if client.is_configured:
        try:
            ctx = await client.get_advisor_context(ticker_limit=100, news_limit=0)
            tickers = ctx.get("tickers", [])
            buy_tickers = [t.get("ticker", "") for t in tickers if (t.get("latest_signal") or "").upper() == "BUY"]
            sell_tickers = [t.get("ticker", "") for t in tickers if (t.get("latest_signal") or "").upper() == "SELL"]
            rsi_values = [t.get("rsi_14") for t in tickers if t.get("rsi_14") is not None]
            avg_rsi = sum(rsi_values) / len(rsi_values) if rsi_values else None
            bullish = sum(1 for t in tickers if t.get("is_bullish") is True)
            bearish = sum(1 for t in tickers if t.get("is_bullish") is False)
            return {
                "total_tickers": len(tickers),
                "tickers_with_buy_signals": buy_tickers,
                "tickers_with_sell_signals": sell_tickers,
                "average_rsi": avg_rsi,
                "bullish_count": bullish,
                "bearish_count": bearish,
                "neutral_count": len(tickers) - bullish - bearish,
            }
        except Exception as exc:
            logger.warning("DataAPI portfolio summary failed: %s", exc)
    return {
        "total_tickers": 0,
        "tickers_with_buy_signals": [],
        "tickers_with_sell_signals": [],
        "average_rsi": None,
        "bullish_count": 0,
        "bearish_count": 0,
        "neutral_count": 0,
    }


@router.get("/api/v1/symbols/search")
async def search_symbols(
    q: str = Query(..., min_length=1, max_length=64),
    limit: int = Query(25, ge=1, le=100),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.search_symbols(q, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI symbol search failed: %s", exc)
    return {"results": []}


@router.get("/api/v1/tickers/{ticker}/fundamentals")
async def get_ticker_fundamentals(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_ticker_fundamentals(ticker)
        except Exception as exc:
            logger.warning("DataAPI fundamentals failed for %s: %s", ticker, exc)
    raise HTTPException(status_code=404, detail=f"No fundamentals for {ticker}")


@router.get("/api/v1/tickers/{ticker}/corporate-actions")
async def get_corporate_actions(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    limit: int = Query(50, ge=1, le=500),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_corporate_actions(ticker, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI corporate actions failed for %s: %s", ticker, exc)
    return {"ticker": ticker, "actions": []}


@router.get("/api/v1/financials/{ticker}/income")
async def get_financials_income(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    limit: int = Query(12, ge=1, le=40),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_financials_income(ticker, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI income failed for %s: %s", ticker, exc)
    return {"ticker": ticker, "statements": []}


@router.get("/api/v1/financials/{ticker}/balance")
async def get_financials_balance(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    limit: int = Query(12, ge=1, le=40),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_financials_balance(ticker, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI balance failed for %s: %s", ticker, exc)
    return {"ticker": ticker, "statements": []}


@router.get("/api/v1/financials/{ticker}/cashflow")
async def get_financials_cashflow(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    limit: int = Query(12, ge=1, le=40),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_financials_cashflow(ticker, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI cashflow failed for %s: %s", ticker, exc)
    return {"ticker": ticker, "statements": []}


@router.get("/api/v1/financials/{ticker}/quality")
async def get_financials_quality(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    limit: int = Query(12, ge=1, le=40),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_financials_quality(ticker, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI quality failed for %s: %s", ticker, exc)
    return {"ticker": ticker, "metrics": []}


@router.get("/api/v1/indicators/{ticker}/risk")
async def get_risk_indicators(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=2000),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_risk_indicators(ticker, start=start, end=end, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI risk indicators failed for %s: %s", ticker, exc)
    return {"ticker": ticker, "indicators": []}


@router.get("/api/v1/indicators/{ticker}/valuation")
async def get_valuation_indicators(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=2000),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_valuation_indicators(ticker, start=start, end=end, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI valuation indicators failed for %s: %s", ticker, exc)
    return {"ticker": ticker, "indicators": []}


@router.get("/api/v1/indicators/{ticker}/returns")
async def get_returns_indicators(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=2000),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_returns_indicators(ticker, start=start, end=end, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI returns indicators failed for %s: %s", ticker, exc)
    return {"ticker": ticker, "returns": []}


@router.get("/api/v1/news/ticker/{ticker}")
async def get_ticker_news(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    limit: int = Query(10, ge=1, le=50),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    ticker = ticker.upper()
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_ticker_news(ticker, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI ticker news failed for %s: %s", ticker, exc)
    return {"ticker": ticker, "news": []}


@router.get("/api/v1/reference/countries")
async def get_reference_countries(_auth: AuthenticatedUser = Depends(require_auth)) -> Dict[str, Any]:
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_reference_countries()
        except Exception as exc:
            logger.warning("DataAPI reference/countries failed: %s", exc)
    return {"countries": []}


@router.get("/api/v1/reference/currencies")
async def get_reference_currencies(_auth: AuthenticatedUser = Depends(require_auth)) -> Dict[str, Any]:
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_reference_currencies()
        except Exception as exc:
            logger.warning("DataAPI reference/currencies failed: %s", exc)
    return {"currencies": []}


@router.get("/api/v1/reference/exchanges")
async def get_reference_exchanges(_auth: AuthenticatedUser = Depends(require_auth)) -> Dict[str, Any]:
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_reference_exchanges()
        except Exception as exc:
            logger.warning("DataAPI reference/exchanges failed: %s", exc)
    return {"exchanges": []}


@router.get("/api/v1/reference/sectors")
async def get_reference_sectors(_auth: AuthenticatedUser = Depends(require_auth)) -> Dict[str, Any]:
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_reference_sectors()
        except Exception as exc:
            logger.warning("DataAPI reference/sectors failed: %s", exc)
    return {"sectors": []}


@router.get("/api/v1/reference/industries")
async def get_reference_industries(
    sector_id: Optional[int] = Query(None),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_reference_industries(sector_id=sector_id)
        except Exception as exc:
            logger.warning("DataAPI reference/industries failed: %s", exc)
    return {"industries": []}


@router.get("/api/v1/reference/calendar")
async def get_reference_calendar(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    limit: int = Query(30, ge=1, le=500),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    client = get_dataapi_client()
    if client.is_configured:
        try:
            return await client.get_reference_calendar(start=start, end=end, limit=limit)
        except Exception as exc:
            logger.warning("DataAPI reference/calendar failed: %s", exc)
    return {"days": []}


@router.post("/api/v1/trades/orders")
async def place_trade_order(
    body: Dict[str, Any],
    idempotency_key: str = Query(..., description="Unique key to prevent duplicate orders"),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    client = get_dataapi_client()
    if not client.is_configured:
        raise HTTPException(status_code=503, detail="Trading data source unavailable")
    try:
        return await client.place_order(
            symbol=body["symbol"],
            side=body["side"],
            quantity=body["quantity"],
            idempotency_key=idempotency_key,
            limit_price=body.get("limit_price"),
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Missing required field: {exc}")
    except Exception as exc:
        logger.error("DataAPI place order failed: %s", exc)
        raise HTTPException(status_code=502, detail="Order placement failed")


@router.get("/api/v1/ai/ticker/{ticker}")
async def get_ticker_details(
    ticker: str = Path(..., pattern=r"^[A-Za-z0-9.]{1,10}$"),
    _auth: AuthenticatedUser = Depends(require_auth),
) -> Dict[str, Any]:
    """Full ticker detail (snapshot + signals + price history), sourced from TheEyeBetaDataAPI."""
    ticker = ticker.upper()
    client = get_dataapi_client()
    if not client.is_configured:
        raise HTTPException(status_code=503, detail="Data source unavailable")

    snapshot: Optional[Dict[str, Any]] = None
    signals: List[Dict[str, Any]] = []
    price_history: List[Dict[str, Any]] = []
    name = ticker

    try:
        snap_data = await client.get_analytics_snapshot(ticker)
        s = snap_data.get("snapshot", {})
        name = s.get("company_name") or ticker
        snapshot = {
            "ticker": ticker,
            "company_name": s.get("company_name"),
            "last_price": s.get("last_price"),
            "price_change_pct": s.get("price_change_pct"),
            "rsi_14": s.get("rsi_14"),
            "sma_50": s.get("sma_50"),
            "sma_200": s.get("sma_200"),
            "macd": s.get("macd"),
            "updated_at": s.get("updated_at"),
        }
    except Exception as exc:
        logger.warning("DataAPI snapshot failed for %s: %s", ticker, exc)

    try:
        sig_data = await client.get_latest_signals(ticker=ticker, limit=10)
        for s in sig_data.get("signals", []):
            signals.append({
                "ticker": ticker,
                "company_name": None,
                "signal": s.get("signal", ""),
                "strategy": s.get("strategy_name", ""),
                "confidence": s.get("confidence"),
                "timestamp": s.get("timestamp", ""),
                "entry_price": s.get("entry_price"),
                "target_price": s.get("target_price"),
                "stop_loss": s.get("stop_loss"),
            })
    except Exception as exc:
        logger.warning("DataAPI signals failed for %s: %s", ticker, exc)

    try:
        hist_data = await client.get_price_history(ticker, limit=30)
        for p in hist_data.get("prices", []):
            price_history.append({
                "timestamp": p.get("date", ""),
                "price": p.get("close"),
                "open": p.get("open"),
                "high": p.get("high"),
                "low": p.get("low"),
                "close": p.get("close"),
                "volume": p.get("volume"),
            })
    except Exception as exc:
        logger.warning("DataAPI price history failed for %s: %s", ticker, exc)

    return {
        "ticker": ticker,
        "name": name,
        "snapshot": snapshot,
        "recent_signals": signals,
        "price_history": price_history,
    }


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
    except Exception as exc:
        logger.warning("Unexpected WebSocket auth error: %s", type(exc).__name__)
        await websocket.close(code=4401, reason="Authentication error.")
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
