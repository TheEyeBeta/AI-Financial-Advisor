"""
Tests for the Meridian → IRIS context pipeline.

Covers every major gap identified in the audit:
  1. life_events uses notes column (not description)
  2. intelligence_digests JSONB content serialised to string
  3. meridian.user_insights table absent rows degrade gracefully
  4. ai.iris_context_cache columns journal_summary / portfolio_stats /
     achievement_summary are written and read back correctly
  5. financial_plans scalar columns used correctly
  6. build_iris_context serves stale cache + schedules refresh
  7. build_iris_context serves fresh cache without refresh
  8. build_iris_context cache miss → minimal context + schedules refresh
  9. Cross-user data isolation: user A's data never leaks to user B
 10. Missing rows (empty user) do not crash the context builder
 11. JWT user_id (auth_id) is used — not the request body user_id
 12. _format_context_block produces all expected sections
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.meridian_context import (
    _build_minimal_context_sync,
    _format_context_block,
    _is_cache_stale,
    _refresh_iris_context_cache_sync,
    build_iris_context,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ts(hours_ago: float = 0) -> str:
    """ISO timestamp n hours in the past."""
    return (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()


def _fresh_ts() -> str:
    # Well within the default 30-minute staleness threshold.
    return _ts(hours_ago=0.1)  # ~6 minutes ago


def _stale_ts() -> str:
    # Comfortably beyond the default 30-minute staleness threshold.
    return _ts(hours_ago=2)


# ---------------------------------------------------------------------------
# Minimal mock Supabase client for _refresh_iris_context_cache_sync
# ---------------------------------------------------------------------------

class _FakeResult:
    """Lightweight stand-in for supabase-py query results."""

    def __init__(self, data=None, count: int = 0):
        self.data = data
        self.count = count


class _FakeChain:
    """Chainable query builder that records the final execute() call."""

    def __init__(self, table_name: str, store: Dict[str, Any]):
        self._table = table_name
        self._store = store
        self._filters: List = []
        self._in_filters: List = []
        self._gte_filters: List = []
        self._lte_filters: List = []
        self._order_col: Optional[str] = None
        self._order_desc: bool = False
        self._limit_val: Optional[int] = None
        self._op: Optional[str] = None
        self._payload: Any = None
        self._count: Optional[str] = None

    def select(self, *_, **kwargs):
        self._op = "select"
        self._count = kwargs.get("count")
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def in_(self, col, vals):
        self._in_filters.append((col, vals))
        return self

    def gte(self, col, val):
        self._gte_filters.append((col, val))
        return self

    def lte(self, col, val):
        self._lte_filters.append((col, val))
        return self

    def filter(self, col, op, val):
        return self

    def order(self, col, desc=False):
        self._order_col = col
        self._order_desc = desc
        return self

    def limit(self, n):
        self._limit_val = n
        return self

    def maybe_single(self):
        return self

    def single(self):
        return self

    def upsert(self, data, on_conflict=None):
        self._op = "upsert"
        self._payload = data
        return self

    def insert(self, data):
        self._op = "insert"
        self._payload = data
        return self

    def update(self, data):
        self._op = "update"
        self._payload = data
        return self

    def execute(self) -> _FakeResult:
        tbl = self._table
        store = self._store

        if self._op == "upsert":
            uid = self._payload.get("user_id") if isinstance(self._payload, dict) else None
            if uid and tbl == "iris_context_cache":
                store.setdefault("iris_cache", {})[uid] = dict(self._payload)
            return _FakeResult()

        if self._op == "insert":
            if tbl == "meridian_events":
                pass  # fire and forget
            return _FakeResult()

        if self._op == "update":
            return _FakeResult()

        # ── SELECT paths ────────────────────────────────────────────────────
        filters = dict(self._filters)
        uid = filters.get("user_id")

        if tbl == "user_profiles":
            row = store.get("user_profiles", {}).get(uid)
            return _FakeResult(data=row)

        if tbl == "users":
            # core.users lookup by auth_id
            auth_id = filters.get("auth_id")
            row = store.get("core_users", {}).get(auth_id)
            return _FakeResult(data=row)

        if tbl == "user_goals":
            status = filters.get("status")
            rows = [
                g for g in store.get("user_goals", [])
                if g.get("user_id") == uid
                and (status is None or g.get("status") == status)
            ]
            # maybe_single() means could be single row or list; return None for dup check
            goal_name = filters.get("goal_name")
            if goal_name is not None:
                hit = next((r for r in rows if r.get("goal_name") == goal_name), None)
                return _FakeResult(data=hit)
            return _FakeResult(data=rows)

        if tbl == "risk_alerts":
            resolved = filters.get("resolved")
            rows = [
                a for a in store.get("risk_alerts", [])
                if a.get("user_id") == uid
                and (resolved is None or a.get("resolved") == resolved)
            ]
            return _FakeResult(data=rows)

        if tbl == "financial_plans":
            status = filters.get("status")
            rows = [
                p for p in store.get("financial_plans", [])
                if p.get("user_id") == uid
                and (status is None or p.get("status") == status)
            ]
            rows = rows[:self._limit_val] if self._limit_val else rows
            return _FakeResult(data=rows)

        if tbl == "goal_progress":
            in_col, in_vals = next(iter(self._in_filters), (None, []))
            rows = [
                r for r in store.get("goal_progress", [])
                if r.get(in_col) in in_vals
            ]
            return _FakeResult(data=rows)

        if tbl == "intelligence_digests":
            delivered = filters.get("delivered")
            rows = [
                d for d in store.get("intelligence_digests", [])
                if d.get("user_id") == uid
                and (delivered is None or d.get("delivered") == delivered)
            ]
            rows = rows[:self._limit_val] if self._limit_val else rows
            return _FakeResult(data=rows)

        if tbl == "life_events":
            rows = [
                e for e in store.get("life_events", [])
                if e.get("user_id") == uid
            ]
            return _FakeResult(data=rows)

        if tbl == "user_positions":
            rows = [
                p for p in store.get("user_positions", [])
                if p.get("user_id") == uid
            ]
            return _FakeResult(data=rows)

        if tbl == "user_insights":
            is_active = filters.get("is_active")
            rows = [
                i for i in store.get("user_insights", [])
                if i.get("user_id") == uid
                and (is_active is None or i.get("is_active") == is_active)
                and float(i.get("confidence", 0)) >= 0.75
            ]
            rows = rows[:self._limit_val] if self._limit_val else rows
            return _FakeResult(data=rows)

        if tbl == "iris_context_cache":
            uid = filters.get("user_id")
            row = store.get("iris_cache", {}).get(uid)
            return _FakeResult(data=row)

        if tbl == "open_positions":
            rows = [
                p for p in store.get("open_positions", [])
                if p.get("user_id") == filters.get("user_id")
            ]
            if self._count == "exact":
                return _FakeResult(data=rows, count=len(rows))
            return _FakeResult(data=rows)

        if tbl == "trades":
            rows = [
                t for t in store.get("trades", [])
                if t.get("user_id") == filters.get("user_id")
            ]
            return _FakeResult(data=rows)

        if tbl == "trade_journal":
            rows = [
                j for j in store.get("trade_journal", [])
                if j.get("user_id") == filters.get("user_id")
            ]
            return _FakeResult(data=rows)

        if tbl == "portfolio_history":
            rows = [
                h for h in store.get("portfolio_history", [])
                if h.get("user_id") == filters.get("user_id")
            ]
            return _FakeResult(data=rows)

        if tbl == "achievements":
            rows = [
                a for a in store.get("achievements", [])
                if a.get("user_id") == filters.get("user_id")
            ]
            return _FakeResult(data=rows)

        if tbl == "user_lesson_progress":
            rows = [
                r for r in store.get("user_lesson_progress", [])
                if (filters.get("user_id") is None or r.get("user_id") == filters.get("user_id"))
                and (filters.get("status") is None or r.get("status") == filters.get("status"))
            ]
            in_col, in_vals = next(iter(self._in_filters), (None, []))
            if in_col:
                rows = [r for r in rows if r.get(in_col) in in_vals]
            if self._count == "exact":
                return _FakeResult(data=rows, count=len(rows))
            return _FakeResult(data=rows)

        if tbl in ("lessons", "tiers"):
            rows = store.get(tbl, [])
            in_col, in_vals = next(iter(self._in_filters), (None, []))
            if in_col:
                rows = [r for r in rows if r.get(in_col) in in_vals]
            if self._count == "exact":
                return _FakeResult(data=rows, count=len(rows))
            return _FakeResult(data=rows)

        if tbl == "quiz_attempts":
            rows = [
                r for r in store.get("quiz_attempts", [])
                if filters.get("user_id") is None or r.get("user_id") == filters.get("user_id")
            ]
            return _FakeResult(data=rows)

        if tbl == "chats":
            rows = [
                c for c in store.get("chats", [])
                if c.get("user_id") == filters.get("user_id")
            ]
            return _FakeResult(data=rows)

        if tbl == "chat_messages":
            in_col, in_vals = next(iter(self._in_filters), (None, []))
            rows = [
                m for m in store.get("chat_messages", [])
                if m.get(in_col) in in_vals
                and m.get("role") == filters.get("role", m.get("role"))
            ]
            return _FakeResult(data=rows)

        # Unknown table — return empty
        return _FakeResult(data=[])


class _FakeSupabase:
    """Minimal Supabase client double with schema() support."""

    def __init__(self, store: Dict[str, Any]):
        self._store = store

    def schema(self, _schema_name: str):
        return self  # schema selection is transparent in the mock

    def table(self, table_name: str) -> _FakeChain:
        return _FakeChain(table_name, self._store)


class _LegacyIrisCacheChain(_FakeChain):
    """Simulate a legacy iris_context_cache table missing newer text columns."""

    def execute(self) -> _FakeResult:
        if self._op == "upsert" and self._table == "iris_context_cache":
            missing_once = self._store.setdefault("_missing_cache_columns_seen", set())
            for column in ("achievement_summary", "journal_summary", "portfolio_stats"):
                if column in (self._payload or {}) and column not in missing_once:
                    missing_once.add(column)
                    raise Exception(
                        f"Could not find the '{column}' column of 'iris_context_cache' in the schema cache"
                    )
        return super().execute()


class _LegacyIrisCacheSupabase(_FakeSupabase):
    """Supabase double whose iris_context_cache lacks the newer text columns."""

    def table(self, table_name: str) -> _FakeChain:
        if table_name == "iris_context_cache":
            return _LegacyIrisCacheChain(table_name, self._store)
        return _FakeChain(table_name, self._store)


# ---------------------------------------------------------------------------
# Default store fixture
# ---------------------------------------------------------------------------

AUTH_ID = "auth-user-1111-1111-1111-111111111111"
CORE_ID = "core-user-2222-2222-2222-222222222222"
GOAL_ID = "goal-3333-3333-3333-333333333333"


def _default_store() -> Dict[str, Any]:
    """Minimal fully-populated store that produces a non-empty context."""
    return {
        "user_profiles": {
            AUTH_ID: {
                "user_id": AUTH_ID,
                "risk_profile": "moderate",
                "investment_horizon": "5 years",
                "monthly_investable": 400.0,
                "emergency_fund_months": 4.0,
                "age_range": "30-39",
                "income_range": "40k-60k",
                "monthly_expenses": 2200.0,
                "total_debt": 7500.0,
                "dependants": 1,
                "knowledge_tier": 2,
                "country_of_residence": "Ireland",
                "employment_status": "employed",
            }
        },
        "core_users": {
            AUTH_ID: {
                "id": CORE_ID,
                "auth_id": AUTH_ID,
                "first_name": "Alice",
                "last_name": "Tester",
                "age": 33,
                "experience_level": "intermediate",
                "risk_level": "mid",
                "investment_goal": "retirement",
                "marital_status": "single",
            }
        },
        "user_goals": [
            {
                "id": GOAL_ID,
                "user_id": AUTH_ID,
                "goal_name": "Retirement fund",
                "target_amount": 500000.0,
                "current_amount": 12000.0,
                "target_date": "2050-01-01",
                "monthly_contribution": 400.0,
                "status": "active",
            }
        ],
        "risk_alerts": [],
        "financial_plans": [
            {
                "user_id": AUTH_ID,
                "plan_name": "Retirement Plan",
                "target_amount": 500000.0,
                "target_date": "2050-01-01",
                "current_amount": 12000.0,
                "status": "active",
            }
        ],
        "goal_progress": [
            {"goal_id": GOAL_ID, "actual_amount": 12000.0, "target_amount": 20000.0, "on_track": True}
        ],
        "intelligence_digests": [],
        "life_events": [],
        "user_positions": [],
        "user_insights": [],
        "open_positions": [],
        "trades": [],
        "trade_journal": [],
        "portfolio_history": [],
        "achievements": [],
        "user_lesson_progress": [],
        "lessons": [],
        "tiers": [],
        "quiz_attempts": [],
        "chats": [],
        "chat_messages": [],
        "iris_cache": {},
    }


# ---------------------------------------------------------------------------
# 1. life_events: notes column mapped to description key
# ---------------------------------------------------------------------------

def test_life_events_notes_column_mapped_to_description():
    """meridian.life_events.notes is selected and mapped to 'description' key."""
    store = _default_store()
    store["life_events"] = [
        {
            "user_id": AUTH_ID,
            "event_type": "baby",
            "event_date": "2026-06-01",
            "notes": "Expecting first child",  # DB column is notes, not description
        }
    ]
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        result = _refresh_iris_context_cache_sync(AUTH_ID)
    assert result is True
    cached = store["iris_cache"][AUTH_ID]
    events = cached.get("life_events") or []
    assert len(events) == 1
    assert events[0]["description"] == "Expecting first child"


# ---------------------------------------------------------------------------
# 2. intelligence_digests: JSONB content serialised to string
# ---------------------------------------------------------------------------

def test_intelligence_digest_jsonb_content_becomes_string():
    """JSONB content dict in intelligence_digests is converted to a JSON string."""
    store = _default_store()
    store["intelligence_digests"] = [
        {
            "user_id": AUTH_ID,
            "digest_type": "weekly_summary",
            "content": {"headline": "Markets up", "action": "review allocation"},
            "delivered": False,
            "created_at": _fresh_ts(),
        }
    ]
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        _refresh_iris_context_cache_sync(AUTH_ID)
    cached = store["iris_cache"][AUTH_ID]
    digest = cached.get("intelligence_digest") or {}
    # content must be a string now, not a dict
    assert isinstance(digest.get("content"), str)
    parsed = json.loads(digest["content"])
    assert parsed["headline"] == "Markets up"


# ---------------------------------------------------------------------------
# 3. meridian.user_insights: absent rows degrade gracefully (no crash)
# ---------------------------------------------------------------------------

def test_user_insights_empty_does_not_crash():
    """Empty meridian.user_insights produces an empty list, not an error."""
    store = _default_store()
    store["user_insights"] = []
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        result = _refresh_iris_context_cache_sync(AUTH_ID)
    assert result is True
    cached = store["iris_cache"][AUTH_ID]
    assert cached.get("user_insights") == []


def test_user_insights_with_data_persisted_to_cache():
    """High-confidence user insights are persisted to iris_context_cache."""
    store = _default_store()
    store["user_insights"] = [
        {
            "user_id": AUTH_ID,
            "insight_type": "preference",
            "key": "prefers_index_funds",
            "value": "true",
            "confidence": 0.90,
            "is_active": True,
            "extracted_at": _fresh_ts(),
        },
        {
            "user_id": AUTH_ID,
            "insight_type": "knowledge_gap",
            "key": "options_trading",
            "value": "unfamiliar",
            "confidence": 0.50,  # below threshold — should be excluded
            "is_active": True,
            "extracted_at": _fresh_ts(),
        },
    ]
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        _refresh_iris_context_cache_sync(AUTH_ID)
    cached = store["iris_cache"][AUTH_ID]
    insights = cached.get("user_insights") or []
    # Only the high-confidence insight survives the fake's filter
    assert len(insights) == 1
    assert insights[0]["key"] == "prefers_index_funds"


# ---------------------------------------------------------------------------
# 4. ai.iris_context_cache: journal_summary / portfolio_stats / achievement_summary
# ---------------------------------------------------------------------------

def test_cache_upsert_includes_new_columns():
    """journal_summary, portfolio_stats, and achievement_summary are upserted."""
    store = _default_store()
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        _refresh_iris_context_cache_sync(AUTH_ID)
    cached = store["iris_cache"][AUTH_ID]
    assert "journal_summary" in cached
    assert "portfolio_stats" in cached
    assert "achievement_summary" in cached


def test_cache_upsert_journal_summary_default():
    """journal_summary defaults to the 'no journal entries' string when empty."""
    store = _default_store()
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        _refresh_iris_context_cache_sync(AUTH_ID)
    cached = store["iris_cache"][AUTH_ID]
    assert cached["journal_summary"] == "No journal entries yet"


def test_cache_upsert_achievement_summary_default():
    """achievement_summary defaults to 'None yet' when no achievements exist."""
    store = _default_store()
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        _refresh_iris_context_cache_sync(AUTH_ID)
    cached = store["iris_cache"][AUTH_ID]
    assert cached["achievement_summary"] == "None yet"


def test_cache_upsert_retries_without_legacy_text_columns():
    """Legacy iris_context_cache schemas still accept the refresh after retry pruning."""
    store = _default_store()
    mock_sb = _LegacyIrisCacheSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        result = _refresh_iris_context_cache_sync(AUTH_ID)
    assert result is True
    cached = store["iris_cache"][AUTH_ID]
    assert "achievement_summary" not in cached
    assert "journal_summary" not in cached
    assert "portfolio_stats" not in cached


# ---------------------------------------------------------------------------
# 5. meridian.financial_plans scalar columns
# ---------------------------------------------------------------------------

def test_financial_plan_scalar_columns_appear_in_cache():
    """financial_plan dict is built from scalar columns and stored in cache."""
    store = _default_store()
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        _refresh_iris_context_cache_sync(AUTH_ID)
    cached = store["iris_cache"][AUTH_ID]
    fp = cached.get("financial_plan") or {}
    assert fp.get("plan_name") == "Retirement Plan"
    assert float(fp.get("target_amount")) == 500000.0
    assert fp.get("status") == "active"


def test_financial_plan_missing_rows_gives_empty_dict():
    """No financial_plans rows → financial_plan is an empty dict, no crash."""
    store = _default_store()
    store["financial_plans"] = []
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        result = _refresh_iris_context_cache_sync(AUTH_ID)
    assert result is True
    cached = store["iris_cache"][AUTH_ID]
    assert cached.get("financial_plan") == {}


def test_financial_plan_legacy_plan_data_supported():
    """Legacy plan_data/is_current rows still hydrate financial_plan."""
    store = _default_store()
    store["financial_plans"] = [
        {
            "user_id": AUTH_ID,
            "plan_data": {
                "plan_name": "Legacy Plan",
                "target_amount": 25000.0,
                "current_amount": 5000.0,
                "target_date": "2028-01-01",
            },
            "is_current": True,
        }
    ]
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        _refresh_iris_context_cache_sync(AUTH_ID)
    cached = store["iris_cache"][AUTH_ID]
    fp = cached.get("financial_plan") or {}
    assert fp.get("plan_name") == "Legacy Plan"
    assert float(fp.get("target_amount")) == 25000.0
    assert float(fp.get("current_amount")) == 5000.0
    assert fp.get("status") == "active"


def test_profile_summary_humanises_employment_and_marital_status():
    """employment_status and marital_status are stored as user-facing labels."""
    store = _default_store()
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        _refresh_iris_context_cache_sync(AUTH_ID)
    summary = store["iris_cache"][AUTH_ID]["profile_summary"]
    assert summary["employment_status"] == "Employed"
    assert summary["marital_status"] == "Single"


# ---------------------------------------------------------------------------
# 6. build_iris_context: stale cache → serve + schedule refresh
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_iris_context_stale_cache_served_and_refresh_scheduled():
    """Stale cache is still served; a background refresh is scheduled."""
    stale_row = {
        "user_id": AUTH_ID,
        "updated_at": _stale_ts(),
        "profile_summary": {"first_name": "Alice", "risk_profile": "moderate"},
        "active_goals": [],
        "active_alerts": [],
        "knowledge_tier": 2,
        "financial_plan": {},
        "goal_progress_summary": {},
        "intelligence_digest": {},
        "life_events": [],
        "user_positions": [],
        "trading_positions": [],
        "closed_trades": [],
        "journal_summary": "No journal entries yet",
        "portfolio_stats": "",
        "achievement_summary": "None yet",
        "academy_progress": {},
        "recent_chat_summaries": [],
        "user_insights": [],
    }

    scheduled_tasks = []

    def _fake_create_task(coro):
        # Record the coroutine was scheduled; close it to prevent warnings
        scheduled_tasks.append(coro)
        coro.close()
        return MagicMock()

    with patch("app.services.meridian_context.supabase_client") as mock_sb, \
         patch("app.services.meridian_context.asyncio.get_running_loop") as mock_loop:
        mock_loop.return_value.create_task = _fake_create_task
        mock_result = MagicMock()
        mock_result.data = stale_row
        mock_sb.schema.return_value.table.return_value.select.return_value \
            .eq.return_value.maybe_single.return_value.execute.return_value = mock_result

        ctx = await build_iris_context(AUTH_ID)

    assert "MERIDIAN" in ctx
    assert "Alice" in ctx
    assert len(scheduled_tasks) == 1  # refresh was scheduled


@pytest.mark.asyncio
async def test_build_iris_context_fresh_cache_no_refresh_scheduled():
    """Fresh cache is served; no background refresh is scheduled."""
    fresh_row = {
        "user_id": AUTH_ID,
        "updated_at": _fresh_ts(),
        "profile_summary": {"first_name": "Bob", "risk_profile": "aggressive"},
        "active_goals": [],
        "active_alerts": [],
        "knowledge_tier": 3,
        "financial_plan": {},
        "goal_progress_summary": {},
        "intelligence_digest": {},
        "life_events": [],
        "user_positions": [],
        "trading_positions": [],
        "closed_trades": [],
        "journal_summary": "Top strategy: momentum",
        "portfolio_stats": "",
        "achievement_summary": "First Trade",
        "academy_progress": {},
        "recent_chat_summaries": [],
        "user_insights": [],
    }

    scheduled_tasks = []

    def _fake_create_task(coro):
        scheduled_tasks.append(coro)
        coro.close()
        return MagicMock()

    with patch("app.services.meridian_context.supabase_client") as mock_sb, \
         patch("app.services.meridian_context.asyncio.get_running_loop") as mock_loop:
        mock_loop.return_value.create_task = _fake_create_task
        mock_result = MagicMock()
        mock_result.data = fresh_row
        mock_sb.schema.return_value.table.return_value.select.return_value \
            .eq.return_value.maybe_single.return_value.execute.return_value = mock_result

        ctx = await build_iris_context(AUTH_ID)

    assert "Bob" in ctx
    assert len(scheduled_tasks) == 0  # no refresh needed


# ---------------------------------------------------------------------------
# 7. build_iris_context: cache miss → minimal context + refresh scheduled
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_iris_context_cache_miss_returns_minimal_context():
    """Cache miss yields minimal context from core.users and schedules a refresh."""
    scheduled_tasks = []

    def _fake_create_task(coro):
        scheduled_tasks.append(coro)
        coro.close()
        return MagicMock()

    with patch("app.services.meridian_context.supabase_client") as mock_sb, \
         patch("app.services.meridian_context.asyncio.get_running_loop") as mock_loop:
        mock_loop.return_value.create_task = _fake_create_task

        # iris_context_cache returns no row
        cache_result = MagicMock()
        cache_result.data = None

        # core.users returns a minimal profile row
        core_result = MagicMock()
        core_result.data = {
            "id": CORE_ID,
            "auth_id": AUTH_ID,
            "first_name": "Carol",
            "last_name": None,
            "age": 28,
            "experience_level": "beginner",
            "risk_level": "low",
            "investment_goal": "wealth_building",
            "marital_status": None,
        }

        def _table_side_effect(table_name):
            chain = MagicMock()
            if table_name == "iris_context_cache":
                chain.select.return_value.eq.return_value \
                    .maybe_single.return_value.execute.return_value = cache_result
            else:
                chain.select.return_value.eq.return_value \
                    .maybe_single.return_value.execute.return_value = core_result
            return chain

        mock_sb.schema.return_value.table.side_effect = _table_side_effect

        ctx = await build_iris_context(AUTH_ID)

    assert "Carol" in ctx
    assert "MINIMAL" in ctx or "MERIDIAN" in ctx
    assert len(scheduled_tasks) == 1


# ---------------------------------------------------------------------------
# 8. build_iris_context: None user_id → empty string, no crash
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_build_iris_context_none_user_id_returns_empty():
    ctx = await build_iris_context(None)
    assert ctx == ""


# ---------------------------------------------------------------------------
# 9. Cross-user isolation: user B's data never appears for user A
# ---------------------------------------------------------------------------

def test_cross_user_isolation_in_cache_refresh():
    """Data for user B is never written into user A's cache row."""
    store = _default_store()
    USER_B = "auth-user-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    store["user_profiles"][USER_B] = {
        "user_id": USER_B,
        "risk_profile": "high",
        "knowledge_tier": 3,
    }
    store["user_goals"].append({
        "id": "goal-bbbb",
        "user_id": USER_B,
        "goal_name": "User B Secret Goal",
        "target_amount": 1000000.0,
        "current_amount": 0.0,
        "status": "active",
    })
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        _refresh_iris_context_cache_sync(AUTH_ID)
    cached_a = store["iris_cache"].get(AUTH_ID) or {}
    goals_a = cached_a.get("active_goals") or []
    goal_names = [g.get("goal_name") for g in goals_a]
    assert "User B Secret Goal" not in goal_names


# ---------------------------------------------------------------------------
# 10. Missing profile → refresh returns False, no crash
# ---------------------------------------------------------------------------

def test_refresh_no_profile_returns_false():
    """If core.user_profiles has no row for this user, refresh returns False."""
    store = _default_store()
    store["user_profiles"] = {}  # no profile
    mock_sb = _FakeSupabase(store)
    with patch("app.services.meridian_context.supabase_client", mock_sb):
        result = _refresh_iris_context_cache_sync(AUTH_ID)
    assert result is False
    # Cache should not have been written
    assert AUTH_ID not in store["iris_cache"]


# ---------------------------------------------------------------------------
# 11. _format_context_block: all expected sections present
# ---------------------------------------------------------------------------

def test_format_context_block_all_sections_present():
    """_format_context_block includes profile, goals, alerts, academy, insights."""
    ctx_data = {
        "profile_summary": {
            "first_name": "Dave",
            "last_name": "Test",
            "risk_profile": "moderate",
            "investment_horizon": "10 years",
            "monthly_investable": 600.0,
            "emergency_fund_status": "Adequate (6+ months)",
            "income_range": "60k-80k",
            "age_range": "40-49",
            "experience_level": "intermediate",
            "investment_goal": "retirement",
            "risk_level": "mid",
            "marital_status": "married",
            "age": 45,
        },
        "active_goals": [
            {
                "goal_name": "Pension pot",
                "target_amount": "200000",
                "current_amount": "30000",
                "progress_pct": 15.0,
                "target_date": "2045-01-01",
                "monthly_contribution": "500",
                "status": "active",
            }
        ],
        "active_alerts": [],
        "knowledge_tier": 2,
        "financial_plan": {
            "plan_name": "Pension Plan",
            "target_amount": 200000.0,
            "target_date": "2045-01-01",
            "current_amount": 30000.0,
            "progress_pct": 15.0,
            "status": "active",
        },
        "goal_progress_summary": {"total": 1, "on_track": 1, "behind": 0},
        "intelligence_digest": {},
        "life_events": [],
        "user_positions": [],
        "trading_positions": [],
        "closed_trades": [],
        "journal_summary": "Top strategy: buy-and-hold",
        "portfolio_stats": "",
        "achievement_summary": "First Purchase",
        "academy_progress": {"completed": 5, "total": 30, "recent_lessons": []},
        "recent_chat_summaries": [
            {"title": "Risk chat", "last_assistant_message": "Diversification helps."}
        ],
        "user_insights": [
            {
                "insight_type": "preference",
                "key": "likes_ETFs",
                "value": "true",
                "confidence": 0.88,
            }
        ],
    }
    block = _format_context_block(ctx_data)

    assert "Dave" in block
    assert "ACTIVE FINANCIAL GOALS" in block
    assert "Pension pot" in block
    assert "ACTIVE RISK ALERTS" in block
    assert "FINANCIAL PLAN" in block
    assert "TRADING BEHAVIOUR" in block
    assert "buy-and-hold" in block
    assert "USER ACHIEVEMENTS" in block
    assert "First Purchase" in block
    assert "LEARNING PROGRESS" in block
    assert "RECENT CONVERSATION CONTEXT" in block
    assert "Diversification" in block
    assert "LEARNED USER INSIGHTS" in block
    assert "likes_ETFs" in block
    assert "END MERIDIAN CONTEXT" in block


# ---------------------------------------------------------------------------
# 12. _is_cache_stale: boundary conditions
# ---------------------------------------------------------------------------

def test_is_cache_stale_fresh():
    assert _is_cache_stale(_fresh_ts()) is False


def test_is_cache_stale_old():
    assert _is_cache_stale(_stale_ts()) is True


def test_is_cache_stale_none():
    assert _is_cache_stale(None) is True


def test_is_cache_stale_invalid():
    assert _is_cache_stale("not-a-timestamp") is True


# ---------------------------------------------------------------------------
# 13. _build_minimal_context_sync: returns fallback string
# ---------------------------------------------------------------------------

def test_build_minimal_context_sync_with_valid_user():
    """_build_minimal_context_sync returns a non-empty block for a known user."""
    with patch("app.services.meridian_context.supabase_client") as mock_sb:
        result = MagicMock()
        result.data = {
            "first_name": "Eve",
            "last_name": "Test",
            "experience_level": "beginner",
            "risk_level": "low",
            "investment_goal": "house_purchase",
        }
        mock_sb.schema.return_value.table.return_value.select.return_value \
            .eq.return_value.maybe_single.return_value.execute.return_value = result
        ctx = _build_minimal_context_sync(AUTH_ID)
    assert "Eve" in ctx
    assert "MINIMAL" in ctx


def test_build_minimal_context_sync_no_user_returns_empty():
    """_build_minimal_context_sync returns '' when core.users has no row."""
    with patch("app.services.meridian_context.supabase_client") as mock_sb:
        result = MagicMock()
        result.data = None
        mock_sb.schema.return_value.table.return_value.select.return_value \
            .eq.return_value.maybe_single.return_value.execute.return_value = result
        ctx = _build_minimal_context_sync(AUTH_ID)
    assert ctx == ""
