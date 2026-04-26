"""End-to-end verification that IRIS receives every advertised data source.

This test seeds a fake Supabase backend with a fully populated user
(portfolio, paper-trading positions/trades/history/journal, academy
progress, financial goals, achievements, financial plan, life events,
learned insights, recent chats), runs the cache refresher used in
production, then runs the formatter that produces the prompt block
sent to the LLM. It asserts that user-visible markers from each data
source appear in the assembled prompt.

It also exercises the three OpenAI tool functions IRIS exposes
(get_portfolio, get_top_stocks, search_market_news) to confirm the
Tavily integration path and trading/market data fetchers are wired up.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from app.services import iris_tools
from app.services.iris_tools import execute_tool
from app.services.meridian_context import (
    _format_context_block,
    _refresh_iris_context_cache_sync,
)
from tests.test_meridian_context_pipeline import (
    AUTH_ID,
    CORE_ID,
    _FakeSupabase,
    _default_store,
    _fresh_ts,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fully_populated_store():
    """A store where the user has data in every IRIS-relevant table."""
    store = _default_store()

    # ── Paper-trading: open positions ─────────────────────────────────────
    store["open_positions"] = [
        {
            "user_id": CORE_ID,
            "symbol": "AAPL",
            "type": "LONG",
            "quantity": 10,
            "entry_price": 150.0,
            "current_price": 175.0,
            "entry_date": "2026-01-15",
            "updated_at": _fresh_ts(),
        },
        {
            "user_id": CORE_ID,
            "symbol": "MSFT",
            "type": "LONG",
            "quantity": 5,
            "entry_price": 380.0,
            "current_price": 405.0,
            "entry_date": "2026-02-01",
            "updated_at": _fresh_ts(),
        },
    ]

    # ── Paper-trading: closed trades ──────────────────────────────────────
    store["trades"] = [
        {
            "user_id": CORE_ID,
            "symbol": "NVDA",
            "type": "LONG",
            "quantity": 3,
            "entry_price": 500.0,
            "exit_price": 620.0,
            "pnl": 360.0,
            "entry_date": "2025-11-01",
            "exit_date": "2026-01-10",
        },
        {
            "user_id": CORE_ID,
            "symbol": "TSLA",
            "type": "LONG",
            "quantity": 2,
            "entry_price": 240.0,
            "exit_price": 220.0,
            "pnl": -40.0,
            "entry_date": "2025-12-01",
            "exit_date": "2026-01-20",
        },
    ]

    # ── Paper-trading: journal ────────────────────────────────────────────
    store["trade_journal"] = [
        {
            "user_id": CORE_ID,
            "symbol": "AAPL",
            "type": "BUY",
            "date": "2026-01-15",
            "strategy": "momentum-breakout",
        },
        {
            "user_id": CORE_ID,
            "symbol": "MSFT",
            "type": "BUY",
            "date": "2026-02-01",
            "strategy": "momentum-breakout",
        },
        {
            "user_id": CORE_ID,
            "symbol": "NVDA",
            "type": "SELL",
            "date": "2026-01-10",
            "strategy": "trend-follow",
        },
    ]

    # ── Paper-trading: portfolio history ──────────────────────────────────
    store["portfolio_history"] = [
        {"user_id": CORE_ID, "date": "2026-04-25", "value": 12500.0},
        {"user_id": CORE_ID, "date": "2026-04-01", "value": 11800.0},
        {"user_id": CORE_ID, "date": "2026-03-26", "value": 11200.0},
    ]

    # ── Achievements ──────────────────────────────────────────────────────
    store["achievements"] = [
        {"user_id": CORE_ID, "name": "First Trade", "unlocked_at": _fresh_ts()},
        {"user_id": CORE_ID, "name": "Five-Lesson Streak", "unlocked_at": _fresh_ts()},
    ]

    # ── Academy progress ──────────────────────────────────────────────────
    store["user_lesson_progress"] = [
        {
            "id": "ulp-1",
            "user_id": CORE_ID,
            "lesson_id": "lesson-101",
            "status": "completed",
            "completed_at": _fresh_ts(),
        },
        {
            "id": "ulp-2",
            "user_id": CORE_ID,
            "lesson_id": "lesson-102",
            "status": "completed",
            "completed_at": _fresh_ts(),
        },
    ]
    store["lessons"] = [
        {"id": "lesson-101", "title": "What is a stock?", "tier_id": "tier-foundations"},
        {"id": "lesson-102", "title": "Diversification basics", "tier_id": "tier-foundations"},
        {"id": "lesson-103", "title": "Reading a 10-K", "tier_id": "tier-fundamentals"},
    ]
    store["tiers"] = [
        {"id": "tier-foundations", "name": "Foundations"},
        {"id": "tier-fundamentals", "name": "Fundamentals"},
    ]

    # ── Life events (within the next 90 days) ─────────────────────────────
    store["life_events"] = [
        {
            "user_id": AUTH_ID,
            "event_type": "house_purchase",
            "event_date": "2026-06-15",
            "notes": "Closing on first home",
        }
    ]

    # ── Meridian portfolio snapshot (separate from paper trading) ─────────
    store["user_positions"] = [
        {
            "user_id": AUTH_ID,
            "ticker": "VWCE",
            "quantity": 12.5,
            "avg_cost": 110.0,
            "current_value": 1450.0,
        }
    ]

    # ── Intelligence digest ───────────────────────────────────────────────
    store["intelligence_digests"] = [
        {
            "user_id": AUTH_ID,
            "digest_type": "weekly_summary",
            "content": {"headline": "Tech rally continues"},
            "delivered": False,
            "created_at": _fresh_ts(),
        }
    ]

    # ── Learned user insights ─────────────────────────────────────────────
    store["user_insights"] = [
        {
            "user_id": AUTH_ID,
            "insight_type": "preference",
            "key": "prefers_index_funds",
            "value": "true",
            "confidence": 0.92,
            "is_active": True,
            "extracted_at": _fresh_ts(),
        }
    ]

    return store


# ---------------------------------------------------------------------------
# End-to-end: every advertised data source reaches the prompt
# ---------------------------------------------------------------------------

def test_iris_prompt_contains_every_user_data_source(fully_populated_store):
    """Refresh cache + format block; assert markers from each data source appear."""
    mock_sb = _FakeSupabase(fully_populated_store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        ok = _refresh_iris_context_cache_sync(AUTH_ID)
    assert ok is True

    cached = fully_populated_store["iris_cache"][AUTH_ID]
    prompt = _format_context_block(cached)

    # ── Identity / profile (core.users + core.user_profiles) ──────────────
    assert "Alice" in prompt, "first_name from core.users missing"
    assert "Tester" in prompt, "last_name from core.users missing"
    assert "intermediate" in prompt, "experience_level missing"
    assert "moderate" in prompt, "risk_profile missing"

    # ── Financial goals (meridian.user_goals) ─────────────────────────────
    assert "Retirement fund" in prompt, "active goal name missing"
    assert "ACTIVE FINANCIAL GOALS" in prompt

    # ── Financial plan (meridian.financial_plans) ─────────────────────────
    assert "FINANCIAL PLAN" in prompt
    assert "Retirement Plan" in prompt

    # ── Life events (meridian.life_events) ────────────────────────────────
    assert "Closing on first home" in prompt, "life event description missing"

    # ── Meridian portfolio snapshot (meridian.user_positions) ─────────────
    assert "VWCE" in prompt, "Meridian portfolio ticker missing"

    # ── Intelligence digest (meridian.intelligence_digests) ───────────────
    assert "Tech rally continues" in prompt, "intelligence digest content missing"

    # ── Paper trading: open positions (trading.open_positions) ────────────
    assert "AAPL" in prompt, "paper-trading open position symbol missing"
    assert "MSFT" in prompt

    # ── Paper trading: closed trades (trading.trades) ─────────────────────
    assert "NVDA" in prompt, "closed trade symbol missing"

    # ── Paper trading: portfolio stats (trading.portfolio_history) ────────
    assert "PORTFOLIO" in prompt, "portfolio stats block heading missing"
    assert "12,500" in prompt or "12500" in prompt, "latest portfolio value missing"

    # ── Paper trading: journal summary (trading.trade_journal) ────────────
    assert "TRADING BEHAVIOUR" in prompt
    assert "momentum-breakout" in prompt, "top strategy from journal missing"
    assert "BUY/SELL ratio" in prompt

    # ── Achievements (core.achievements) ──────────────────────────────────
    assert "USER ACHIEVEMENTS" in prompt
    assert "First Trade" in prompt

    # ── Academy progress (academy.user_lesson_progress + lessons + tiers) ──
    assert "LEARNING PROGRESS" in prompt
    assert "Diversification basics" in prompt or "What is a stock?" in prompt, \
        "no completed lesson title in prompt"
    assert "Foundations" in prompt, "academy tier name missing"

    # ── Learned insights (meridian.user_insights) ─────────────────────────
    assert "LEARNED USER INSIGHTS" in prompt
    assert "prefers_index_funds" in prompt

    # ── Closing banner so the system prompt knows the context ended ───────
    assert "END MERIDIAN CONTEXT" in prompt


# ---------------------------------------------------------------------------
# All three IRIS tools are reachable via the dispatcher
# ---------------------------------------------------------------------------

def test_tool_definitions_advertise_portfolio_top_stocks_and_news():
    names = {t["function"]["name"] for t in iris_tools.TOOL_DEFINITIONS}
    assert names == {"get_portfolio", "get_top_stocks", "search_market_news"}


@pytest.mark.asyncio
async def test_get_portfolio_tool_returns_user_paper_trading(fully_populated_store):
    """execute_tool('get_portfolio') returns the paper-trading data for the user."""
    mock_sb = _FakeSupabase(fully_populated_store)
    with patch("app.services.iris_tools.supabase_client", mock_sb):
        raw = await execute_tool("get_portfolio", {}, AUTH_ID)
    payload = json.loads(raw)
    assert payload.get("portfolio_value") == 12500.0
    assert payload.get("total_open_positions") == 2
    assert any("AAPL" in line for line in payload.get("open_positions", []))
    assert any("NVDA" in line for line in payload.get("recent_trades", []))


@pytest.mark.asyncio
async def test_get_top_stocks_tool_returns_market_rankings():
    """execute_tool('get_top_stocks') hits market.trending_stocks + macro_snapshots."""
    store = _default_store()
    store["trending_stocks"] = [
        {
            "ticker": "NVDA",
            "name": "NVIDIA",
            "composite_score": 92.0,
            "momentum_score": 95.0,
            "trend_score": 90.0,
            "volume_score": 88.0,
            "adx_score": 70.0,
            "rank_tier": "A",
            "conviction": "High",
            "change_percent": 2.4,
            "ranked_at": _fresh_ts(),
        }
    ]
    store["macro_snapshots"] = [
        {
            "vix": 14.2,
            "yield_10y": 4.1,
            "sp500_level": 5300.0,
            "sp500_change_pct": 0.6,
            "fed_funds_rate": 4.5,
        }
    ]

    class _MarketFakeChain:
        """Tiny chain that knows only the two market tables this tool reads."""
        def __init__(self, table_name, store):
            self.tbl = table_name
            self.store = store
            self._limit = None

        def select(self, *_a, **_k): return self
        def order(self, *_a, **_k): return self
        def limit(self, n):
            self._limit = n
            return self

        def execute(self):
            class R:  # noqa: D401
                pass
            r = R()
            if self.tbl == "trending_stocks":
                r.data = self.store.get("trending_stocks", [])[: self._limit or 25]
            elif self.tbl == "macro_snapshots":
                r.data = self.store.get("macro_snapshots", [])[: self._limit or 1]
            else:
                r.data = []
            return r

    class _MarketFake:
        def __init__(self, store):
            self.store = store

        def schema(self, _):
            return self

        def table(self, name):
            return _MarketFakeChain(name, self.store)

    with patch("app.services.iris_tools.supabase_client", _MarketFake(store)):
        raw = await execute_tool("get_top_stocks", {"limit": 5}, AUTH_ID)
    payload = json.loads(raw)
    assert payload["top_stocks"][0]["ticker"] == "NVDA"
    assert payload["top_stocks"][0]["rank"] == 1
    assert payload["macro_context"]["vix"] == 14.2
    assert payload["macro_context"]["sp500"] == 5300.0


@pytest.mark.asyncio
async def test_search_market_news_tool_calls_tavily(monkeypatch):
    """execute_tool('search_market_news') sends an HTTPS request to Tavily."""
    monkeypatch.setattr(iris_tools, "TAVILY_API_KEY", "tvly-test-key")

    captured = {}

    class _FakeResponse:
        status_code = 200
        def json(self):
            return {
                "answer": "Apple beat consensus by 5%.",
                "results": [
                    {
                        "title": "AAPL Q1 results",
                        "url": "https://example.com/aapl-q1",
                        "content": "Apple reported strong iPhone sales " * 30,
                    }
                ],
            }

    class _FakeAsyncClient:
        def __init__(self, *_a, **_k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def post(self, url, json=None):
            captured["url"] = url
            captured["payload"] = json
            return _FakeResponse()

    with patch("app.services.iris_tools.httpx.AsyncClient", _FakeAsyncClient):
        raw = await execute_tool(
            "search_market_news", {"query": "AAPL earnings"}, AUTH_ID
        )

    payload = json.loads(raw)
    assert captured["url"] == "https://api.tavily.com/search"
    assert captured["payload"]["query"] == "AAPL earnings"
    assert captured["payload"]["api_key"] == "tvly-test-key"
    assert payload["answer"].startswith("Apple beat")
    assert payload["sources"][0]["url"] == "https://example.com/aapl-q1"
    # Source content is truncated to 500 chars to keep prompts cheap
    assert len(payload["sources"][0]["content"]) == 500


@pytest.mark.asyncio
async def test_search_market_news_tool_blocked_without_api_key(monkeypatch):
    """Iris cannot leak unrelated calls when TAVILY_API_KEY is not configured."""
    monkeypatch.setattr(iris_tools, "TAVILY_API_KEY", "")
    raw = await execute_tool("search_market_news", {"query": "AAPL"}, AUTH_ID)
    payload = json.loads(raw)
    assert "error" in payload
    assert payload["query"] == "AAPL"
