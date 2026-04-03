# backend/websearch_service/app/services/market_context.py
"""
Market context layer — reads from market schema tables and formats
data for injection into IRIS system prompts.

Schema routing:
  market.macro_snapshots            → client.schema("market").table("macro_snapshots")
  market.stock_price_history        → client.schema("market").table("stock_price_history")
  market.stock_fundamentals_history → client.schema("market").table("stock_fundamentals_history")
"""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)


def _table(client, schema_name: str, table_name: str):
    """Return schema-qualified table handle, compatible with test doubles."""
    if hasattr(client, "schema"):
        return client.schema(schema_name).table(table_name)
    return client.table(table_name)


# ── Sync fetchers (run in threads to avoid blocking the event loop) ───────────

def _fetch_macro_sync() -> Optional[dict]:
    client = supabase_client
    if not client:
        return None
    result = (
        _table(client, "market", "macro_snapshots")
        .select("*")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def _fetch_price_history_sync(ticker: str) -> List[dict]:
    client = supabase_client
    if not client:
        return []
    result = (
        _table(client, "market", "stock_price_history")
        .select("*")
        .eq("ticker", ticker)
        .order("date", desc=True)
        .limit(90)
        .execute()
    )
    return result.data or []


def _fetch_fundamentals_sync(ticker: str) -> List[dict]:
    client = supabase_client
    if not client:
        return []
    result = (
        _table(client, "market", "stock_fundamentals_history")
        .select("*")
        .eq("ticker", ticker)
        .order("date", desc=True)
        .limit(90)
        .execute()
    )
    return result.data or []


# ── Formatters ─────────────────────────────────────────────────────────────────

def _format_macro(row: dict) -> str:
    date = row.get("date", "unknown")
    regime = row.get("market_regime", "N/A")
    vix = row.get("vix", "N/A")
    sp500 = row.get("sp500_level", "N/A")
    sp500_chg = row.get("sp500_change_pct", "N/A")
    yield_10y = row.get("yield_10y", "N/A")
    yield_2y = row.get("yield_2y", "N/A")
    spread = row.get("yield_curve_spread", "N/A")
    try:
        curve_label = "inverted" if float(spread) < 0 else "normal"
    except (TypeError, ValueError):
        curve_label = "N/A"
    sector_leaders = row.get("sector_leaders", "N/A")
    sector_laggards = row.get("sector_laggards", "N/A")
    return (
        f"=== MACRO CONTEXT (as of {date}) ===\n"
        f"Market Regime: {regime}\n"
        f"VIX: {vix} | S&P 500: {sp500} ({sp500_chg}%)\n"
        f"10Y Yield: {yield_10y}% | 2Y Yield: {yield_2y}%\n"
        f"Yield Curve: {spread}% ({curve_label})\n"
        f"Sector Leaders: {sector_leaders}\n"
        f"Sector Laggards: {sector_laggards}"
    )


def _format_price_history(ticker: str, rows: List[dict]) -> str:
    if not rows:
        return (
            f"=== PRICE HISTORY: {ticker} (last 90 days) ===\n"
            "Data not yet available."
        )
    # rows are ordered desc: rows[0] is most recent, rows[-1] is oldest
    latest = rows[0]
    oldest = rows[-1]
    latest_close = latest.get("close", "N/A")
    oldest_close = oldest.get("close", "N/A")
    try:
        pct_change = ((float(latest_close) - float(oldest_close)) / float(oldest_close)) * 100
        pct_str = f"{pct_change:+.2f}"
    except (TypeError, ValueError, ZeroDivisionError):
        pct_str = "N/A"
    high_52w = latest.get("high_52w", "N/A")
    low_52w = latest.get("low_52w", "N/A")
    rsi = latest.get("rsi_14", "N/A")
    sma50 = latest.get("sma_50", "N/A")
    sma200 = latest.get("sma_200", "N/A")
    is_bullish = latest.get("is_bullish")
    try:
        close_f = float(latest_close)
        sma50_f = float(sma50)
        sma200_f = float(sma200)
        if is_bullish is True or (close_f > sma50_f and sma50_f > sma200_f):
            trend = "Bullish"
        elif is_bullish is False or (close_f < sma50_f and sma50_f < sma200_f):
            trend = "Bearish"
        else:
            trend = "Neutral"
    except (TypeError, ValueError):
        if is_bullish is True:
            trend = "Bullish"
        elif is_bullish is False:
            trend = "Bearish"
        else:
            trend = "Neutral"
    return (
        f"=== PRICE HISTORY: {ticker} (last 90 days) ===\n"
        f"Current: {latest_close} | 90d ago: {oldest_close} | Change: {pct_str}%\n"
        f"52W High: {high_52w} | 52W Low: {low_52w}\n"
        f"Latest RSI: {rsi} | SMA50: {sma50} | SMA200: {sma200}\n"
        f"Trend: {trend}"
    )


def _format_fundamentals(ticker: str, rows: List[dict]) -> str:
    if not rows:
        return (
            f"=== FUNDAMENTALS: {ticker} (most recent) ===\n"
            "Data not yet available."
        )
    row = rows[0]
    pe = row.get("pe_ratio", "N/A")
    fwd_pe = row.get("forward_pe", "N/A")
    peg = row.get("peg_ratio", "N/A")
    pb = row.get("price_to_book", "N/A")
    ps = row.get("price_to_sales", "N/A")
    eps_growth = row.get("eps_growth", "N/A")
    rev_growth = row.get("revenue_growth", "N/A")
    div_yield = row.get("dividend_yield", "N/A")
    return (
        f"=== FUNDAMENTALS: {ticker} (most recent) ===\n"
        f"P/E: {pe} | Forward P/E: {fwd_pe} | PEG: {peg}\n"
        f"P/B: {pb} | P/S: {ps}\n"
        f"EPS Growth: {eps_growth}% | Revenue Growth: {rev_growth}%\n"
        f"Dividend Yield: {div_yield}%"
    )


# ── Public API ─────────────────────────────────────────────────────────────────

async def build_market_context(ticker: Optional[str] = None) -> str:
    """
    Builds market context string for IRIS system prompt injection.

    Always fetches the most recent row from market.macro_snapshots regardless
    of date — uses .order("date", desc=True).limit(1) so yesterday's data is
    returned when today's engine run has not yet completed.

    If ticker is provided, also fetches from market.stock_price_history and
    market.stock_fundamentals_history for the last 90 days.

    GRACEFUL DEGRADATION: Wraps every query in try/except. On any failure,
    a descriptive note is included in the returned string. Always returns a
    non-empty string — never raises.
    """
    parts: List[str] = []

    # A. Always fetch macro context
    try:
        macro_row = await asyncio.to_thread(_fetch_macro_sync)
        if macro_row:
            parts.append(_format_macro(macro_row))
        else:
            parts.append("=== MACRO CONTEXT ===\nData not yet available.")
    except Exception as exc:
        logger.warning("market_context: macro_snapshots fetch failed: %s", exc)
        parts.append("=== MACRO CONTEXT ===\nData not yet available.")

    # B. If ticker provided, fetch price history and fundamentals
    if ticker:
        try:
            price_rows = await asyncio.to_thread(_fetch_price_history_sync, ticker)
            parts.append(_format_price_history(ticker, price_rows))
        except Exception as exc:
            logger.warning(
                "market_context: stock_price_history fetch failed for %s: %s", ticker, exc
            )
            parts.append(
                f"=== PRICE HISTORY: {ticker} (last 90 days) ===\n"
                "Data not yet available."
            )

        try:
            fund_rows = await asyncio.to_thread(_fetch_fundamentals_sync, ticker)
            parts.append(_format_fundamentals(ticker, fund_rows))
        except Exception as exc:
            logger.warning(
                "market_context: stock_fundamentals_history fetch failed for %s: %s", ticker, exc
            )
            parts.append(
                f"=== FUNDAMENTALS: {ticker} (most recent) ===\n"
                "Data not yet available."
            )

    return "\n\n".join(parts)
