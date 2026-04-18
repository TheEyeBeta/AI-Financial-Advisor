# backend/websearch_service/app/services/iris_tools.py
"""
IRIS tool definitions, executors, and dispatcher for OpenAI function calling.

Three tools are exposed:
  1. get_portfolio          — live trading data for the user
  2. get_top_stocks         — The Eye's top ranked tickers + macro snapshot
  3. search_market_news     — Tavily web search

Each executor is async, wraps Supabase sync calls via asyncio.to_thread(),
and returns a dict that the dispatcher serialises to JSON for the OpenAI
tool-result message. Errors are swallowed into an {"error": ...} dict so
that a single tool failure never crashes the chat pipeline.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import date
from typing import Any, Dict, List, Optional

import httpx

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)

TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
_TAVILY_ENDPOINT = "https://api.tavily.com/search"
_TAVILY_TIMEOUT = 8.0  # seconds — hard cap so we never block the chat pipeline


# ── Tool schema definitions (sent to OpenAI) ──────────────────────────────────

TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_portfolio",
            "description": (
                "Get the user's current portfolio including open positions, "
                "recent closed trades, portfolio value history, and aggregate "
                "statistics. Call this when the user asks about their portfolio, "
                "positions, P&L, returns, or trading performance."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_stocks",
            "description": (
                "Get the current top ranked stocks from The Eye ranking engine. "
                "Returns stocks ranked by composite score based on momentum, "
                "trend, quality, volume, and ADX. Call this when the user asks "
                "about best stocks, top performers, what to buy, stock "
                "recommendations, or market rankings."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Number of top stocks to return. Default 10, max 25.",
                        "default": 10,
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_market_news",
            "description": (
                "Search for current news and information about a specific stock, "
                "company, or market topic using web search. Call this when the "
                "user asks about recent news, analyst views, earnings, or events "
                "for a specific company or market topic."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "The search query. Include company name or ticker "
                            "and topic. Example: 'Apple AAPL earnings Q1 2026' "
                            "or 'Federal Reserve interest rate decision'"
                        ),
                    },
                },
                "required": ["query"],
            },
        },
    },
]


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _table(client, schema_name: str, table_name: str):
    """Return a schema-qualified table handle (compatible with simple test doubles)."""
    if hasattr(client, "schema"):
        return client.schema(schema_name).table(table_name)
    return client.table(table_name)


def _resolve_core_user_id(auth_id: str) -> Optional[str]:
    """Resolve core.users.id from an auth_id. Returns None if not found."""
    client = supabase_client
    if not client or not auth_id:
        return None
    try:
        res = (
            _table(client, "core", "users")
            .select("id")
            .eq("auth_id", auth_id)
            .maybe_single()
            .execute()
        )
        return ((res and res.data) or {}).get("id")
    except Exception:
        logger.exception("iris_tools: failed to resolve core.users.id for auth_id=%s", auth_id)
        return None


# ── TOOL 1: get_portfolio ─────────────────────────────────────────────────────

def _fetch_portfolio_sync(auth_id: str) -> Dict[str, Any]:
    """Sync Supabase fetch for get_portfolio. May raise."""
    client = supabase_client
    if not client:
        return {"error": "Supabase client not configured"}

    core_user_id = _resolve_core_user_id(auth_id)
    if not core_user_id:
        return {
            "error": "No trading account found for this user.",
            "data_as_of": date.today().isoformat(),
        }

    open_res = (
        _table(client, "trading", "open_positions")
        .select("symbol, quantity, entry_price, current_price, type, entry_date")
        .eq("user_id", core_user_id)
        .order("entry_date", desc=True)
        .limit(20)
        .execute()
    )
    open_rows = (open_res and open_res.data) or []

    trades_res = (
        _table(client, "trading", "trades")
        .select("symbol, quantity, entry_price, exit_price, pnl, type, exit_date")
        .eq("user_id", core_user_id)
        .filter("exit_date", "not.is", "null")
        .order("exit_date", desc=True)
        .limit(20)
        .execute()
    )
    trade_rows = (trades_res and trades_res.data) or []

    history_res = (
        _table(client, "trading", "portfolio_history")
        .select("date, value")
        .eq("user_id", core_user_id)
        .order("date", desc=True)
        .limit(30)
        .execute()
    )
    history_rows = (history_res and history_res.data) or []

    # Format open positions
    open_positions: List[str] = []
    for pos in open_rows:
        symbol = pos.get("symbol") or "?"
        ptype = (pos.get("type") or "").upper() or "LONG"
        qty = pos.get("quantity") or 0
        entry = float(pos.get("entry_price") or 0)
        current = float(pos.get("current_price") or entry)
        pct = ((current - entry) / entry * 100) if entry > 0 else 0.0
        pct_str = f"{pct:+.1f}%"
        open_positions.append(
            f"{symbol} {ptype} x{qty} @ ${entry:,.2f} entry, "
            f"current ${current:,.2f} ({pct_str})"
        )

    # Format recent (closed) trades
    recent_trades: List[str] = []
    for tr in trade_rows:
        symbol = tr.get("symbol") or "?"
        ttype = (tr.get("type") or "").upper() or "LONG"
        qty = tr.get("quantity") or 0
        entry = float(tr.get("entry_price") or 0)
        exit_p = float(tr.get("exit_price") or entry)
        pnl = float(tr.get("pnl") or 0)
        pnl_pct = ((exit_p - entry) / entry * 100) if entry > 0 else 0.0
        exit_date = tr.get("exit_date")
        if hasattr(exit_date, "isoformat"):
            exit_date = exit_date.isoformat()
        recent_trades.append(
            f"{symbol} {ttype} x{qty} — entered ${entry:,.2f} exited ${exit_p:,.2f} "
            f"(${pnl:+,.2f} / {pnl_pct:+.1f}%) on {exit_date}"
        )

    # Aggregate stats
    latest_value: Optional[float] = None
    value_30d_ago: Optional[float] = None
    value_change: Optional[float] = None
    if history_rows:
        latest_value = float(history_rows[0].get("value") or 0)
        value_30d_ago = float(history_rows[-1].get("value") or 0)
        value_change = latest_value - value_30d_ago

    total_closed = len(trade_rows)
    realized_pnl = sum(float(t.get("pnl") or 0) for t in trade_rows)
    winners = sum(1 for t in trade_rows if float(t.get("pnl") or 0) > 0)
    win_rate = (winners / total_closed * 100) if total_closed > 0 else 0.0

    return {
        "portfolio_value": latest_value,
        "value_change_30d": value_change,
        "open_positions": open_positions,
        "recent_trades": recent_trades,
        "total_open_positions": len(open_rows),
        "realized_pnl": round(realized_pnl, 2),
        "win_rate": round(win_rate, 1),
        "data_as_of": date.today().isoformat(),
    }


async def get_portfolio_data(user_id: str) -> Dict[str, Any]:
    """Async wrapper — fetch portfolio for user_id (auth_id). Never raises."""
    try:
        return await asyncio.to_thread(_fetch_portfolio_sync, user_id)
    except Exception as exc:
        logger.exception("get_portfolio_data failed for user_id=%s", user_id)
        return {"error": f"Portfolio lookup failed: {exc}"}


# ── TOOL 2: get_top_stocks ────────────────────────────────────────────────────

def _build_why_top(stock: Dict[str, Any]) -> str:
    """Compose a one-line plain-English rationale from the top two scoring dimensions."""
    score_fields = [
        ("momentum", float(stock.get("momentum_score") or 0), "strong momentum"),
        ("trend", float(stock.get("trend_score") or 0), "confirmed uptrend"),
        ("volume", float(stock.get("volume_score") or 0), "rising volume flow"),
        ("adx", float(stock.get("adx_score") or 0), "strong directional strength"),
    ]
    ranked = sorted(score_fields, key=lambda x: x[1], reverse=True)[:2]
    phrases = [f"{phrase} ({score:.0f}/100)" for _, score, phrase in ranked if score > 0]
    conviction = stock.get("conviction")
    if conviction:
        phrases.append(f"{conviction} conviction rating")
    return ", ".join(phrases) if phrases else "Ranked by composite score."


def _fetch_top_stocks_sync(limit: int) -> Dict[str, Any]:
    """Sync Supabase fetch for get_top_stocks. May raise."""
    client = supabase_client
    if not client:
        return {"error": "Supabase client not configured"}

    capped = max(1, min(int(limit or 10), 25))

    stocks_res = (
        _table(client, "market", "trending_stocks")
        .select(
            "ticker, name, composite_score, momentum_score, trend_score, "
            "volume_score, adx_score, rank_tier, conviction, "
            "change_percent, ranked_at"
        )
        .order("composite_score", desc=True)
        .limit(capped)
        .execute()
    )
    stock_rows = (stocks_res and stocks_res.data) or []

    macro_res = (
        _table(client, "market", "macro_snapshots")
        .select("vix, yield_10y, sp500_level, sp500_change_pct, fed_funds_rate")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    macro_rows = (macro_res and macro_res.data) or []
    macro = macro_rows[0] if macro_rows else {}

    ranked_at = None
    if stock_rows:
        ranked_at = stock_rows[0].get("ranked_at")
        if hasattr(ranked_at, "isoformat"):
            ranked_at = ranked_at.isoformat()

    top_stocks: List[Dict[str, Any]] = []
    for idx, s in enumerate(stock_rows, start=1):
        top_stocks.append({
            "rank": idx,
            "ticker": s.get("ticker"),
            "name": s.get("name"),
            "composite_score": s.get("composite_score"),
            "momentum_score": s.get("momentum_score"),
            "trend_score": s.get("trend_score"),
            "volume_score": s.get("volume_score"),
            "adx_score": s.get("adx_score"),
            "rank_tier": s.get("rank_tier"),
            "conviction": s.get("conviction"),
            "change_percent": s.get("change_percent"),
            "why_top": _build_why_top(s),
        })

    return {
        "ranked_at": str(ranked_at) if ranked_at else None,
        "macro_context": {
            "vix": macro.get("vix"),
            "sp500": macro.get("sp500_level"),
            "sp500_change": macro.get("sp500_change_pct"),
            "yield_10y": macro.get("yield_10y"),
            "fed_funds": macro.get("fed_funds_rate"),
        },
        "top_stocks": top_stocks,
    }


async def get_top_stocks_data(limit: int = 10) -> Dict[str, Any]:
    """Async wrapper — fetch top ranked stocks. Never raises."""
    try:
        return await asyncio.to_thread(_fetch_top_stocks_sync, limit)
    except Exception as exc:
        logger.exception("get_top_stocks_data failed for limit=%s", limit)
        return {"error": f"Top stocks lookup failed: {exc}"}


# ── TOOL 3: search_market_news ────────────────────────────────────────────────

async def search_market_news_data(query: str) -> Dict[str, Any]:
    """Call Tavily search. Hard 8-second timeout; any error returns an error dict."""
    if not TAVILY_API_KEY:
        return {"error": "Web search is not configured.", "query": query}

    payload = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "search_depth": "basic",
        "max_results": 5,
        "include_answer": True,
    }

    try:
        async with httpx.AsyncClient(timeout=_TAVILY_TIMEOUT) as client:
            response = await client.post(_TAVILY_ENDPOINT, json=payload)
        if response.status_code != 200:
            logger.warning("Tavily search returned HTTP %d", response.status_code)
            return {"error": f"Search provider returned HTTP {response.status_code}", "query": query}

        data = response.json()
        results = data.get("results") or []
        sources = []
        for r in results[:5]:
            content = r.get("content") or ""
            sources.append({
                "title": r.get("title"),
                "url": r.get("url"),
                "content": content[:500],
            })
        return {
            "query": query,
            "answer": data.get("answer"),
            "sources": sources,
        }
    except httpx.TimeoutException:
        logger.warning("Tavily search timed out after %.1fs for query=%r", _TAVILY_TIMEOUT, query[:80])
        return {"error": "Search timed out", "query": query}
    except Exception as exc:
        logger.exception("Tavily search failed for query=%r", query[:80])
        return {"error": str(exc), "query": query}


# ── Dispatcher ────────────────────────────────────────────────────────────────

async def execute_tool(tool_name: str, tool_args: Dict[str, Any], user_id: str) -> str:
    """Route a tool call to its executor. Returns the result as a JSON string.

    Never raises — on any unexpected failure, returns a JSON-encoded error dict.
    """
    tool_args = tool_args or {}
    try:
        if tool_name == "get_portfolio":
            result: Dict[str, Any] = await get_portfolio_data(user_id)
        elif tool_name == "get_top_stocks":
            limit = tool_args.get("limit", 10)
            try:
                limit = int(limit)
            except (TypeError, ValueError):
                limit = 10
            result = await get_top_stocks_data(limit)
        elif tool_name == "search_market_news":
            query = str(tool_args.get("query") or "").strip()
            if not query:
                result = {"error": "Missing 'query' argument", "query": ""}
            else:
                result = await search_market_news_data(query)
        else:
            result = {"error": f"Unknown tool: {tool_name}"}
    except Exception as exc:
        logger.exception("execute_tool failure for tool=%s", tool_name)
        result = {"error": f"Tool execution failed: {exc}", "tool": tool_name}

    return json.dumps(result, default=str)
