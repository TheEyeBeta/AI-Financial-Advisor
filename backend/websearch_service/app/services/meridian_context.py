# backend/websearch_service/app/services/meridian_context.py
"""
Meridian context layer — reads from core & meridian schemas,
writes to ai.iris_context_cache for IRIS personalisation.

Schema routing:
  core.user_profiles           → client.schema("core").table("user_profiles")
  meridian.user_goals          → client.schema("meridian").table("user_goals")
  meridian.risk_alerts         → client.schema("meridian").table("risk_alerts")
  meridian.financial_plans     → client.schema("meridian").table("financial_plans")
  meridian.goal_progress       → client.schema("meridian").table("goal_progress")
  meridian.intelligence_digests→ client.schema("meridian").table("intelligence_digests")
  meridian.life_events         → client.schema("meridian").table("life_events")
  meridian.user_positions      → client.schema("meridian").table("user_positions")
  meridian.meridian_events     → client.schema("meridian").table("meridian_events")
  ai.iris_context_cache        → client.schema("ai").table("iris_context_cache")
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)


def _sanitise_for_prompt(value: str | None, max_length: int = 100) -> str:
    """
    Sanitises user-supplied strings before injecting into AI system prompt.
    Prevents prompt injection via profile fields.
    """
    if value is None:
        return "not set"
    value = str(value).strip()
    value = value.replace("\n", " ")
    value = value.replace("\r", " ")
    value = value.replace("```", "")
    value = value.replace("###", "")
    value = value.replace("---", "")
    value = value.replace("==", "")
    value = value.replace("IGNORE", "")
    value = value.replace("ignore", "")
    value = value.replace("system:", "")
    value = value.replace("System:", "")
    value = value.replace("assistant:", "")
    value = value.replace("Assistant:", "")
    if len(value) > max_length:
        value = value[:max_length] + "..."
    return value.strip() or "not set"


def _table(client, schema_name: str, table_name: str):
    """Return a schema-qualified table handle, with compatibility for simple test doubles."""
    if hasattr(client, "schema"):
        return client.schema(schema_name).table(table_name)
    return client.table(table_name)


# ── Context injection (read ai.iris_context_cache → format for IRIS) ─────────

def _fetch_iris_cache_sync(user_id: str) -> Optional[dict]:
    """Sync fetch of ai.iris_context_cache row."""
    client = supabase_client
    if not client:
        return None
    try:
        result = (
            _table(client, "ai", "iris_context_cache")
            .select("*")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if result is None:
            return None
        return result.data if result.data else None
    except Exception:
        logger.exception("DB query failed: ai.iris_context_cache SELECT for user_id=%s", user_id)
        return None


# core.users columns surfaced into IRIS context so the advisor knows
# the user's name, age bracket, experience level, risk appetite, goal, etc.
_CORE_USER_CONTEXT_COLUMNS = (
    "id, auth_id, first_name, last_name, age, experience_level, "
    "risk_level, investment_goal, marital_status"
)


def _fetch_core_user_sync(auth_id: str) -> Dict[str, Any]:
    """Sync fetch of core.users row keyed by auth_id. Returns {} on miss/error."""
    client = supabase_client
    if not client or not auth_id:
        return {}
    try:
        res = (
            _table(client, "core", "users")
            .select(_CORE_USER_CONTEXT_COLUMNS)
            .eq("auth_id", auth_id)
            .maybe_single()
            .execute()
        )
        return ((res and res.data) or {}) or {}
    except Exception:
        logger.exception("DB query failed: core.users SELECT for auth_id=%s", auth_id)
        return {}


def _build_minimal_context_sync(auth_id: str) -> str:
    """
    Build a small, fast context block from core.users only, for use on cache
    miss. Never queries meridian.* or trading.* — the full refresh runs
    asynchronously so the chat pipeline is not blocked.
    """
    core_user = _fetch_core_user_sync(auth_id)
    if not core_user:
        return ""
    tier = 1
    first_name = _sanitise_for_prompt(core_user.get("first_name"), max_length=40)
    last_name = _sanitise_for_prompt(core_user.get("last_name"), max_length=40)
    name_parts = [p for p in (first_name, last_name) if p and p != "not set"]
    display_name = " ".join(name_parts) if name_parts else "not set"
    return (
        "\n"
        "################################################################################\n"
        "# MERIDIAN — MINIMAL USER CONTEXT (full refresh running in background)\n"
        "################################################################################\n"
        "\n"
        "USER PROFILE:\n"
        f"- Name: {display_name}\n"
        f"- Experience level: {_sanitise_for_prompt(core_user.get('experience_level'), max_length=30)}\n"
        f"- Risk level: {_sanitise_for_prompt(core_user.get('risk_level'), max_length=30)}\n"
        f"- Investment goal: {_sanitise_for_prompt(core_user.get('investment_goal'), max_length=40)}\n"
        "\n"
        f"KNOWLEDGE TIER: {tier}\n"
        "Adapt communication depth and vocabulary accordingly.\n"
        "\n"
        "################################################################################\n"
        "# END MERIDIAN CONTEXT — IRIS SYSTEM PROMPT FOLLOWS\n"
        "################################################################################\n"
        "\n"
    )


# Cache staleness threshold. Beyond this age the cache is still served,
# but a refresh is scheduled asynchronously in the background.
_CACHE_STALE_AFTER = timedelta(hours=24)


def _is_cache_stale(updated_at: Any) -> bool:
    """Return True if the cache row's updated_at is older than _CACHE_STALE_AFTER."""
    if not updated_at:
        return True
    try:
        if hasattr(updated_at, "isoformat"):
            ts = updated_at
        else:
            ts = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - ts) > _CACHE_STALE_AFTER
    except Exception:
        return True


def _schedule_background_refresh(user_id: str) -> None:
    """Fire-and-forget: kick off a full Meridian cache refresh without blocking."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(refresh_iris_context_cache(user_id))


async def build_iris_context(user_id: Optional[str]) -> str:
    """
    Fetches user's Meridian context from ai.iris_context_cache.
    Returns a formatted string prepended to FINANCIAL_ADVISOR_SYSTEM_PROMPT.

    Non-blocking policy:
      - Fresh cache hit  → serve it.
      - Stale cache hit  → serve it, schedule async refresh.
      - Cache miss       → serve minimal context from core.users, schedule async refresh.
    The chat pipeline is never blocked by a full 13-table rebuild.

    GRACEFUL DEGRADATION: Any failure returns "" so IRIS always works.
    """
    if not user_id:
        return ""

    try:
        data = await asyncio.to_thread(_fetch_iris_cache_sync, user_id)

        if data:
            if _is_cache_stale(data.get("updated_at")):
                logger.info("IRIS cache stale for user %s — scheduling async refresh", user_id)
                _schedule_background_refresh(user_id)
            return _format_context_block(data)

        # Cache miss — never block the chat. Build a minimal context from
        # core.users (name + tier) so IRIS still greets the user personally,
        # then kick off a full refresh in the background.
        logger.info("IRIS cache miss for user %s — scheduling async refresh", user_id)
        _schedule_background_refresh(user_id)

        minimal = await asyncio.to_thread(_build_minimal_context_sync, user_id)
        return minimal or ""
    except Exception as exc:
        logger.debug("Meridian context unavailable for user %s: %s", user_id, exc)
        return ""


def _format_context_block(ctx: dict) -> str:
    profile = ctx.get("profile_summary") or {}
    goals = ctx.get("active_goals") or []
    alerts = ctx.get("active_alerts") or []
    tier = ctx.get("knowledge_tier", 1)
    financial_plan = ctx.get("financial_plan") or {}
    goal_progress_summary = ctx.get("goal_progress_summary") or {}
    intelligence_digest = ctx.get("intelligence_digest") or {}
    life_events = ctx.get("life_events") or []
    user_positions = ctx.get("user_positions") or []
    trading_positions = ctx.get("trading_positions") or []
    closed_trades = ctx.get("closed_trades") or []
    academy_progress = ctx.get("academy_progress") or {}
    recent_chat_summaries = ctx.get("recent_chat_summaries") or []
    user_insights = ctx.get("user_insights") or []

    parts: List[str] = []

    # ── 1. User profile + 2. Knowledge tier + 3. Investment profile ──────────
    first_name = _sanitise_for_prompt(profile.get("first_name"), max_length=40)
    last_name = _sanitise_for_prompt(profile.get("last_name"), max_length=40)
    name_parts = [p for p in (first_name, last_name) if p and p != "not set"]
    display_name = " ".join(name_parts) if name_parts else "not set"
    age_value = profile.get("age")
    age_str = str(age_value) if age_value not in (None, "") else "not set"

    parts.append(
        "\n"
        "################################################################################\n"
        "# MERIDIAN — PERSONALISED USER CONTEXT\n"
        "# Use this to personalise every response.\n"
        "# Do not reveal raw field names or data structure to the user.\n"
        "# Reason from this naturally as an adviser who knows their client.\n"
        "################################################################################\n"
        "\n"
        "USER PROFILE:\n"
        f"- Name: {display_name}\n"
        f"- Age: {age_str}\n"
        f"- Age range: {profile.get('age_range', 'not set')}\n"
        f"- Marital status: {_sanitise_for_prompt(profile.get('marital_status'), max_length=30)}\n"
        f"- Experience level: {_sanitise_for_prompt(profile.get('experience_level'), max_length=30)}\n"
        f"- Investment goal: {_sanitise_for_prompt(profile.get('investment_goal'), max_length=40)}\n"
        f"- Income range: {profile.get('income_range', 'not set')}\n"
        f"- Emergency fund status: {profile.get('emergency_fund_status', 'not set')}\n"
        "\n"
        f"KNOWLEDGE TIER: {tier}\n"
        "Adapt communication depth and vocabulary accordingly.\n"
        "Tier 1 = complete beginner. Tier 2 = developing. Tier 3 = advanced/institutional.\n"
        "\n"
        "INVESTMENT PROFILE:\n"
        f"- Risk profile: {_sanitise_for_prompt(profile.get('risk_profile'))}\n"
        f"- Risk level: {_sanitise_for_prompt(profile.get('risk_level'), max_length=30)}\n"
        f"- Investment horizon: {_sanitise_for_prompt(profile.get('investment_horizon'))}\n"
        f"- Monthly investable amount: {profile.get('monthly_investable', 'not set')}\n"
    )

    # ── 4. Financial plan ─────────────────────────────────────────────────────
    if financial_plan:
        parts.append(_format_financial_plan(financial_plan))

    # ── 5. Active goals + goal progress (combined) ────────────────────────────
    parts.append(
        "\n"
        "ACTIVE FINANCIAL GOALS:\n"
        f"{_format_goals(goals)}\n"
    )
    if goal_progress_summary:
        parts.append(_format_goal_progress(goal_progress_summary))

    # ── 6. Risk alerts ────────────────────────────────────────────────────────
    parts.append(
        "\n"
        "ACTIVE RISK ALERTS:\n"
        f"{_format_alerts(alerts)}\n"
    )

    # ── 7. Life events ────────────────────────────────────────────────────────
    if life_events:
        parts.append(_format_life_events(life_events))

    # ── 8. Meridian portfolio snapshot ────────────────────────────────────────
    if user_positions:
        parts.append(_format_user_positions(user_positions))

    # ── 9. Pending intelligence digest (always last — most actionable) ────────
    if intelligence_digest:
        parts.append(_format_intelligence_digest(intelligence_digest))

    # ── 10. Live trading positions + recent closed trades ─────────────────────
    if trading_positions or closed_trades:
        parts.append(_format_trading_positions(trading_positions, closed_trades))

    # ── 10B. Portfolio value + aggregate trade statistics ─────────────────────
    if ctx.get("portfolio_stats"):
        parts.append(ctx["portfolio_stats"])

    # ── 11. Academy progress ───────────────────────────────────────────────────
    parts.append(_format_academy_progress(academy_progress))

    # ── 12. Recent conversation context ──────────────────────────────────────
    if recent_chat_summaries:
        parts.append(_format_recent_chat_summaries(recent_chat_summaries))

    # ── 13. Learned user insights (always last before closing banner) ─────────
    if user_insights:
        parts.append(_format_user_insights(user_insights))

    parts.append(
        "\n"
        "################################################################################\n"
        "# END MERIDIAN CONTEXT — IRIS SYSTEM PROMPT FOLLOWS\n"
        "################################################################################\n"
        "\n"
    )

    return "".join(parts)


def _format_goals(goals: list) -> str:
    if not goals:
        return "No goals set yet."
    lines = []
    for g in goals:
        progress = g.get("progress_pct", 0)
        monthly = g.get("monthly_contribution")
        monthly_str = f", contributing €{float(monthly):,.0f}/month" if monthly else ""
        lines.append(
            f"- {_sanitise_for_prompt(g.get('goal_name'), max_length=80)}: "
            f"€{float(g.get('current_amount', 0)):,.0f} of "
            f"€{float(g.get('target_amount', 0)):,.0f} "
            f"({float(progress):.0f}% complete) — "
            f"target date: {g.get('target_date', 'not set')}"
            f"{monthly_str}"
        )
    return "\n".join(lines)


def _format_alerts(alerts: list) -> str:
    if not alerts:
        return "No active alerts."
    lines = []
    for a in alerts:
        lines.append(
            f"- [{_sanitise_for_prompt(a.get('severity', 'info'), max_length=20).upper()}] "
            f"{_sanitise_for_prompt(a.get('alert_type'), max_length=50)}: "
            f"{_sanitise_for_prompt(a.get('message'), max_length=200)}"
        )
    return "\n".join(lines)


def _format_financial_plan(plan: dict) -> str:
    name = _sanitise_for_prompt(plan.get("plan_name"), max_length=80)
    target = float(plan.get("target_amount") or 0)
    target_date = plan.get("target_date") or "not set"
    current = float(plan.get("current_amount") or 0)
    pct = float(plan.get("progress_pct") or 0)
    status = _sanitise_for_prompt(plan.get("status"), max_length=30)
    return (
        "\n"
        "FINANCIAL PLAN:\n"
        f"Financial Plan: {name} — Target €{target:,.0f} by {target_date}. "
        f"Current progress: €{current:,.0f} ({pct:.0f}% complete). "
        f"Status: {status}.\n"
    )


def _format_goal_progress(summary: dict) -> str:
    total = summary.get("total", 0)
    on_track = summary.get("on_track", 0)
    behind = summary.get("behind", 0)
    return (
        f"Goal Progress: {total} goals tracked. "
        f"{on_track} on track, {behind} behind target.\n"
    )


def _format_life_events(events: list) -> str:
    lines = ["\nUPCOMING LIFE EVENTS:"]
    for e in events:
        event_type = _sanitise_for_prompt(e.get("event_type"), max_length=50)
        event_date = e.get("event_date") or "unknown date"
        description = _sanitise_for_prompt(e.get("description"), max_length=100)
        lines.append(f"- {event_type} on {event_date} — {description}")
    return "\n".join(lines) + "\n"


def _format_user_positions(positions: list) -> str:
    lines = ["\nMERIDIAN PORTFOLIO SNAPSHOT:"]
    for pos in positions:
        ticker = _sanitise_for_prompt(pos.get("ticker"), max_length=10)
        qty = pos.get("quantity") or 0
        avg_cost = float(pos.get("avg_cost") or 0)
        current_value = float(pos.get("current_value") or 0)
        lines.append(
            f"- {ticker} x{qty} @ avg €{avg_cost:,.2f}, "
            f"current €{current_value:,.2f}"
        )
    return "\n".join(lines) + "\n"


def _format_intelligence_digest(digest: dict) -> str:
    content = _sanitise_for_prompt(digest.get("content"), max_length=300)
    return (
        "\n"
        "PENDING INTELLIGENCE:\n"
        f"Pending Intelligence: {content}\n"
    )


def _format_trading_positions(positions: list, closed_trades: list) -> str:
    """Format live trading positions and recent closed trades (context block 10)."""
    parts: List[str] = []

    if positions:
        parts.append("\n=== LIVE TRADING POSITIONS ===\n")
        for pos in positions:
            symbol = _sanitise_for_prompt(pos.get("symbol"), max_length=10)
            pos_type = _sanitise_for_prompt(pos.get("type"), max_length=10)
            qty = pos.get("quantity", 0)
            entry = float(pos.get("entry_price") or 0)
            current = float(pos.get("current_price") or entry)
            pnl = float(pos.get("pnl_pct") or 0)
            pnl_str = f"+{pnl:.1f}%" if pnl >= 0 else f"{pnl:.1f}%"
            parts.append(
                f"{symbol} {pos_type} x{qty} @ entry ${entry:,.2f}, "
                f"current ${current:,.2f} ({pnl_str})\n"
            )

    if closed_trades:
        parts.append("\n=== RECENT CLOSED TRADES ===\n")
        for trade in closed_trades:
            symbol = _sanitise_for_prompt(trade.get("symbol"), max_length=10)
            trade_type = _sanitise_for_prompt(trade.get("type"), max_length=10)
            qty = trade.get("quantity", 0)
            entry = float(trade.get("entry_price") or 0)
            exit_p = float(trade.get("exit_price") or entry)
            pnl = float(trade.get("pnl_pct") or 0)
            pnl_str = f"+{pnl:.1f}%" if pnl >= 0 else f"{pnl:.1f}%"
            exit_date = trade.get("exit_date", "unknown")
            parts.append(
                f"{symbol} {trade_type} x{qty} — entered ${entry:,.2f} exited ${exit_p:,.2f} "
                f"({pnl_str}) on {exit_date}\n"
            )

    return "".join(parts)


def _format_portfolio_stats(
    portfolio_history_rows: list,
    total_trades: int,
    total_open_positions: int,
    win_rate: float,
    realized_pnl: float,
    avg_profit: float,
    avg_loss: float,
    profit_factor: Optional[float],
) -> str:
    """Format portfolio value + aggregate trade stats (context block 10B)."""
    lines = ["\n=== PORTFOLIO SUMMARY ==="]

    if portfolio_history_rows:
        latest_value = float(portfolio_history_rows[0].get("value") or 0)
        oldest_value = float(portfolio_history_rows[-1].get("value") or 0)
        change = latest_value - oldest_value
        pct = (change / oldest_value * 100) if oldest_value != 0 else 0.0
        lines.append(f"Current Portfolio Value: €{latest_value:,.2f}")
        lines.append(f"  (30-day change: {change:+,.2f} / {pct:+.1f}%)")

    if total_trades == 0:
        lines.append("\nNo closed trades yet.")
    else:
        lines.append("\nTrade Statistics (all-time):")
        lines.append(f"  Total trades: {total_trades}")
        lines.append(f"  Open positions: {total_open_positions}")
        lines.append(f"  Win rate: {win_rate:.1f}%")
        lines.append(f"  Realized P&L: €{realized_pnl:+,.2f}")
        lines.append(f"  Avg profit per winner: €{avg_profit:,.2f}")
        lines.append(f"  Avg loss per loser: €{avg_loss:,.2f}")
        if profit_factor is None:
            lines.append("  Profit factor: N/A")
        else:
            lines.append(f"  Profit factor: {profit_factor:.2f}x")

    return "\n".join(lines) + "\n"


def _format_academy_progress(progress: dict) -> str:
    """Format academy learning progress (context block 11)."""
    if not progress:
        return (
            "\n=== LEARNING PROGRESS ===\n"
            "No lessons completed yet. User is new to the academy.\n"
        )

    completed = progress.get("completed", 0)
    total = progress.get("total", 0)
    recent = progress.get("recent_lessons") or []

    parts = [
        "\n=== LEARNING PROGRESS ===\n",
        f"Completed {completed} of {total} lessons.\n",
    ]

    if recent:
        recent_strs = [
            f"{_sanitise_for_prompt(r.get('title'), max_length=60)} "
            f"({_sanitise_for_prompt(r.get('tier_name'), max_length=30)})"
            for r in recent
        ]
        parts.append(f"Recently completed: {', '.join(recent_strs)}\n")

    return "".join(parts)


def _format_recent_chat_summaries(summaries: list) -> str:
    """Format recent chat context for continuity (context block 12)."""
    if not summaries:
        return ""
    parts = ["\n=== RECENT CONVERSATION CONTEXT ===\n"]
    for s in summaries:
        title = _sanitise_for_prompt(s.get("title") or "Untitled chat", max_length=80)
        content = s.get("last_assistant_message") or ""
        snippet = content[:150].rstrip()
        if len(content) > 150:
            snippet += "..."
        parts.append(f"Previous chat: '{title}' — {snippet}\n")
    return "".join(parts)


def _format_user_insights(insights: list) -> str:
    """Format learned user insights (context block 13)."""
    if not insights:
        return ""

    INSIGHT_TYPE_ORDER = [
        "financial_fact",
        "life_event",
        "preference",
        "compliance_signal",
        "knowledge_gap",
        "emotional_marker",
    ]

    INSIGHT_TYPE_LABELS = {
        "financial_fact": "Financial Facts",
        "life_event": "Life Events",
        "preference": "Preferences",
        "compliance_signal": "Compliance",
        "knowledge_gap": "Knowledge Gaps",
        "emotional_marker": "Emotional Markers",
    }

    # Group by insight_type
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for insight in insights:
        itype = insight.get("insight_type") or "other"
        if itype not in grouped:
            grouped[itype] = []
        grouped[itype].append(insight)

    lines = ["\n=== LEARNED USER INSIGHTS ==="]

    for itype in INSIGHT_TYPE_ORDER:
        if itype not in grouped:
            continue
        label = INSIGHT_TYPE_LABELS.get(itype, itype)
        items = []
        for insight in grouped[itype]:
            key = _sanitise_for_prompt(insight.get("key"), max_length=50)
            value = _sanitise_for_prompt(insight.get("value"), max_length=100)
            confidence = insight.get("confidence") or 0
            confidence_pct = round(float(confidence) * 100)
            items.append(f"{key} = {value} ({confidence_pct}%)")
        lines.append(f"{label}: {' | '.join(items)}")

    return "\n".join(lines) + "\n"


# ── Cache refresh (Prompt 3 Part A) ──────────────────────────────────────────

def _build_plan_summary(goals: list, on_track: list, off_track: list) -> str:
    if not goals:
        return "No goals defined yet."
    total = len(goals)
    if not off_track:
        return f"All {total} goal(s) on track."
    if not on_track:
        return f"{len(off_track)} goal(s) need attention: {', '.join(off_track)}."
    return (
        f"{len(on_track)} goal(s) on track. "
        f"{len(off_track)} need attention: {', '.join(off_track)}."
    )


def _refresh_iris_context_cache_sync(user_id: str) -> bool:
    """
    Reads from core.user_profiles, meridian.user_goals, meridian.risk_alerts,
    meridian.financial_plans, meridian.goal_progress, meridian.intelligence_digests,
    meridian.life_events, and meridian.user_positions.
    Computes plan status and emergency fund assessment.
    Writes structured summary to ai.iris_context_cache.
    Returns True on success, False on failure.
    """
    client = supabase_client
    if not client:
        raise ValueError("Supabase client not configured")

    # 1. Fetch from core.user_profiles
    try:
        profile_res = (
            _table(client, "core", "user_profiles")
            .select("*")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        profile = (profile_res and profile_res.data) or {}
    except Exception:
        logger.exception("DB query failed: core.user_profiles SELECT for user_id=%s", user_id)
        raise

    if not profile:
        logger.info("No profile found in core.user_profiles for user_id=%s — skipping cache refresh", user_id)
        return False

    # 2. Fetch active goals from meridian.user_goals
    try:
        goals_res = (
            _table(client, "meridian", "user_goals")
            .select("*")
            .eq("user_id", user_id)
            .eq("status", "active")
            .execute()
        )
        goals = (goals_res and goals_res.data) or []
    except Exception:
        logger.exception("DB query failed: meridian.user_goals SELECT for user_id=%s", user_id)
        raise

    # 3. Fetch unresolved alerts from meridian.risk_alerts
    alerts: List[Dict[str, Any]] = []
    try:
        alerts_res = (
            _table(client, "meridian", "risk_alerts")
            .select("*")
            .eq("user_id", user_id)
            .eq("resolved", False)
            .execute()
        )
        alerts = (alerts_res and alerts_res.data) or []
    except Exception:
        # Non-critical — continue without alerts
        logger.warning("Could not fetch risk_alerts for user_id=%s", user_id)

    # 4. Fetch most recent active financial plan from meridian.financial_plans
    financial_plan: Dict[str, Any] = {}
    try:
        fp_res = (
            _table(client, "meridian", "financial_plans")
            .select("plan_name, target_amount, target_date, current_amount, status")
            .eq("user_id", user_id)
            .eq("status", "active")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        fp_rows = (fp_res and fp_res.data) or []
        if fp_rows:
            p = fp_rows[0]
            target_amount = float(p.get("target_amount") or 0)
            current_amount = float(p.get("current_amount") or 0)
            pct = (current_amount / target_amount * 100) if target_amount > 0 else 0.0
            target_date = p.get("target_date")
            if hasattr(target_date, "isoformat"):
                target_date = target_date.isoformat()
            financial_plan = {
                "plan_name": p.get("plan_name"),
                "target_amount": target_amount,
                "target_date": str(target_date) if target_date else None,
                "current_amount": current_amount,
                "status": p.get("status"),
                "progress_pct": round(pct, 2),
            }
    except Exception:
        logger.exception("DB query failed: meridian.financial_plans SELECT for user_id=%s", user_id)

    # 5. Fetch goal progress for user's active goals from meridian.goal_progress
    goal_progress_summary: Dict[str, Any] = {}
    try:
        goal_ids = [g["id"] for g in goals if g.get("id")]
        if goal_ids:
            gp_res = (
                _table(client, "meridian", "goal_progress")
                .select("goal_id, period, actual_amount, target_amount, on_track")
                .in_("goal_id", goal_ids)
                .execute()
            )
            gp_records = (gp_res and gp_res.data) or []
            if gp_records:
                on_track_count = sum(1 for r in gp_records if r.get("on_track"))
                behind_count = len(gp_records) - on_track_count
                goal_progress_summary = {
                    "total": len(gp_records),
                    "on_track": on_track_count,
                    "behind": behind_count,
                }
    except Exception:
        logger.exception("DB query failed: meridian.goal_progress SELECT for user_id=%s", user_id)

    # 6. Fetch most recent unread intelligence digest from meridian.intelligence_digests
    intelligence_digest: Dict[str, Any] = {}
    try:
        digest_res = (
            _table(client, "meridian", "intelligence_digests")
            .select("digest_type, content, created_at")
            .eq("user_id", user_id)
            .eq("delivered", False)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        digest_rows = (digest_res and digest_res.data) or []
        if digest_rows:
            d = digest_rows[0]
            created_at = d.get("created_at")
            if hasattr(created_at, "isoformat"):
                created_at = created_at.isoformat()
            intelligence_digest = {
                "digest_type": d.get("digest_type"),
                "content": d.get("content"),
                "created_at": str(created_at) if created_at else None,
            }
    except Exception:
        logger.exception("DB query failed: meridian.intelligence_digests SELECT for user_id=%s", user_id)

    # 7. Fetch life events within the next 90 days from meridian.life_events
    life_events: List[Dict[str, Any]] = []
    try:
        now = datetime.now(timezone.utc)
        today_str = now.date().isoformat()
        cutoff_str = (now + timedelta(days=90)).date().isoformat()
        le_res = (
            _table(client, "meridian", "life_events")
            .select("event_type, event_date, description")
            .eq("user_id", user_id)
            .gte("event_date", today_str)
            .lte("event_date", cutoff_str)
            .order("event_date")
            .execute()
        )
        for le in ((le_res and le_res.data) or []):
            event_date = le.get("event_date")
            if hasattr(event_date, "isoformat"):
                event_date = event_date.isoformat()
            life_events.append({
                "event_type": le.get("event_type"),
                "event_date": str(event_date) if event_date else None,
                "description": le.get("description"),
            })
    except Exception:
        logger.exception("DB query failed: meridian.life_events SELECT for user_id=%s", user_id)

    # 8. Fetch current positions from meridian.user_positions
    user_positions: List[Dict[str, Any]] = []
    try:
        pos_res = (
            _table(client, "meridian", "user_positions")
            .select("ticker, quantity, avg_cost, current_value")
            .eq("user_id", user_id)
            .execute()
        )
        for pos in ((pos_res and pos_res.data) or []):
            user_positions.append({
                "ticker": pos.get("ticker"),
                "quantity": pos.get("quantity"),
                "avg_cost": pos.get("avg_cost"),
                "current_value": pos.get("current_value"),
            })
    except Exception:
        logger.exception("DB query failed: meridian.user_positions SELECT for user_id=%s", user_id)

    # ── NEW BLOCK 10: Trading history ─────────────────────────────────────────
    # Requires core.users.id (app UUID), not the auth_id stored in user_id.
    trading_positions: List[Dict[str, Any]] = []
    closed_trades: List[Dict[str, Any]] = []
    core_user_id: Optional[str] = None  # resolved once; reused by blocks 11 and beyond
    core_user_row: Dict[str, Any] = {}
    try:
        # Resolve core.users.id from auth_id AND surface identity fields that
        # IRIS needs (name, age, experience/risk, investment_goal, marital_status).
        core_user_res = (
            _table(client, "core", "users")
            .select(_CORE_USER_CONTEXT_COLUMNS)
            .eq("auth_id", user_id)
            .maybe_single()
            .execute()
        )
        core_user_row = ((core_user_res and core_user_res.data) or {}) or {}
        core_user_id = core_user_row.get("id")

        if core_user_id:
            # Open positions (20 most recent by entry_date DESC)
            open_pos_res = (
                _table(client, "trading", "open_positions")
                .select("symbol, quantity, entry_price, current_price, type, entry_date, updated_at")
                .eq("user_id", core_user_id)
                .order("entry_date", desc=True)
                .limit(20)
                .execute()
            )
            for pos in ((open_pos_res and open_pos_res.data) or []):
                entry_price = float(pos.get("entry_price") or 0)
                current_price = float(pos.get("current_price") or entry_price)
                pnl_pct = (
                    (current_price - entry_price) / entry_price * 100
                    if entry_price > 0 else 0.0
                )
                entry_date = pos.get("entry_date")
                if hasattr(entry_date, "isoformat"):
                    entry_date = entry_date.isoformat()
                trading_positions.append({
                    "symbol": pos.get("symbol"),
                    "type": pos.get("type"),
                    "quantity": pos.get("quantity"),
                    "entry_price": entry_price,
                    "current_price": current_price,
                    "pnl_pct": round(pnl_pct, 2),
                    "entry_date": str(entry_date) if entry_date else None,
                })

            # Closed trades (10 most recent by exit_date DESC, exit_date IS NOT NULL)
            closed_trades_res = (
                _table(client, "trading", "trades")
                .select("symbol, quantity, entry_price, exit_price, type, entry_date, exit_date")
                .eq("user_id", core_user_id)
                .filter("exit_date", "not.is", "null")
                .order("exit_date", desc=True)
                .limit(10)
                .execute()
            )
            for trade in ((closed_trades_res and closed_trades_res.data) or []):
                entry_price = float(trade.get("entry_price") or 0)
                exit_price = float(trade.get("exit_price") or entry_price)
                trade_type = (trade.get("type") or "").upper()
                # Invert P&L sign for SHORT positions
                if trade_type == "SHORT":
                    pnl_pct = (
                        (entry_price - exit_price) / entry_price * 100
                        if entry_price > 0 else 0.0
                    )
                else:
                    pnl_pct = (
                        (exit_price - entry_price) / entry_price * 100
                        if entry_price > 0 else 0.0
                    )
                exit_date = trade.get("exit_date")
                if hasattr(exit_date, "isoformat"):
                    exit_date = exit_date.isoformat()
                closed_trades.append({
                    "symbol": trade.get("symbol"),
                    "type": trade.get("type"),
                    "quantity": trade.get("quantity"),
                    "entry_price": entry_price,
                    "exit_price": exit_price,
                    "pnl_pct": round(pnl_pct, 2),
                    "exit_date": str(exit_date) if exit_date else None,
                })
    except Exception:
        logger.exception("DB query failed: trading positions/trades for user_id=%s", user_id)

    # ── NEW BLOCK 10B: Portfolio history + aggregate trade stats ─────────────
    # Reuses core_user_id resolved above. Each query isolated so a single
    # failure does not wipe out the others.
    portfolio_history_rows: List[Dict[str, Any]] = []
    all_closed_trades: List[Dict[str, Any]] = []
    total_open_positions: int = 0
    portfolio_stats_str: str = ""
    if core_user_id:
        try:
            ph_res = (
                _table(client, "trading", "portfolio_history")
                .select("date, value")
                .eq("user_id", core_user_id)
                .order("date", desc=True)
                .limit(30)
                .execute()
            )
            portfolio_history_rows = (ph_res and ph_res.data) or []
        except Exception:
            logger.warning("Could not fetch trading.portfolio_history for user_id=%s", user_id)
            portfolio_history_rows = []

        try:
            all_trades_res = (
                _table(client, "trading", "trades")
                .select("pnl, type")
                .eq("user_id", core_user_id)
                .filter("exit_date", "not.is", "null")
                .execute()
            )
            all_closed_trades = (all_trades_res and all_trades_res.data) or []
        except Exception:
            logger.warning("Could not fetch trading.trades aggregate for user_id=%s", user_id)
            all_closed_trades = []

        try:
            open_count_res = (
                _table(client, "trading", "open_positions")
                .select("id")
                .eq("user_id", core_user_id)
                .execute()
            )
            total_open_positions = len((open_count_res and open_count_res.data) or [])
        except Exception:
            logger.warning("Could not fetch trading.open_positions count for user_id=%s", user_id)
            total_open_positions = 0

        total_trades = len(all_closed_trades)
        winning_pnls = [float(t.get("pnl") or 0) for t in all_closed_trades if float(t.get("pnl") or 0) > 0]
        losing_pnls = [float(t.get("pnl") or 0) for t in all_closed_trades if float(t.get("pnl") or 0) < 0]
        winning_trades = len(winning_pnls)
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0.0
        realized_pnl = sum(float(t.get("pnl") or 0) for t in all_closed_trades)
        avg_profit = (sum(winning_pnls) / len(winning_pnls)) if winning_pnls else 0.0
        avg_loss = (sum(losing_pnls) / len(losing_pnls)) if losing_pnls else 0.0
        profit_factor: Optional[float] = (
            (sum(winning_pnls) / abs(sum(losing_pnls))) if losing_pnls else None
        )

        portfolio_stats_str = _format_portfolio_stats(
            portfolio_history_rows=portfolio_history_rows,
            total_trades=total_trades,
            total_open_positions=total_open_positions,
            win_rate=win_rate,
            realized_pnl=realized_pnl,
            avg_profit=avg_profit,
            avg_loss=avg_loss,
            profit_factor=profit_factor,
        )

    # ── NEW BLOCK 11: Academy progress ────────────────────────────────────────
    academy_progress: Dict[str, Any] = {}
    try:
        # core_user_id was resolved in block 10 (None if that block failed)
        if core_user_id:
            # Count of completed lessons for this user
            completed_res = (
                _table(client, "academy", "user_lesson_progress")
                .select("lesson_id, status, completed_at")
                .eq("user_id", core_user_id)
                .eq("status", "completed")
                .order("completed_at", desc=True)
                .limit(5)
                .execute()
            )
            completed_rows = (completed_res and completed_res.data) or []

            # Total completed count (separate query for accuracy)
            total_completed_res = (
                _table(client, "academy", "user_lesson_progress")
                .select("id", count="exact")
                .eq("user_id", core_user_id)
                .eq("status", "completed")
                .execute()
            )
            total_completed = (
                total_completed_res.count
                if hasattr(total_completed_res, "count") and total_completed_res.count is not None
                else len(completed_rows)
            )

            # Total lessons available
            total_lessons_res = (
                _table(client, "academy", "lessons")
                .select("id", count="exact")
                .execute()
            )
            total_lessons = (
                total_lessons_res.count
                if hasattr(total_lessons_res, "count") and total_lessons_res.count is not None
                else 0
            )

            # Fetch lesson titles and tier_ids for the 5 most recently completed
            recent_lesson_ids = [r["lesson_id"] for r in completed_rows if r.get("lesson_id")]
            recent_lessons_detail: List[Dict[str, Any]] = []
            if recent_lesson_ids:
                lessons_res = (
                    _table(client, "academy", "lessons")
                    .select("id, title, tier_id")
                    .in_("id", recent_lesson_ids)
                    .execute()
                )
                lessons_by_id = {
                    r["id"]: r for r in ((lessons_res and lessons_res.data) or []) if r.get("id")
                }

                # Fetch tier names
                tier_ids = list({l["tier_id"] for l in lessons_by_id.values() if l.get("tier_id")})
                tiers_by_id: Dict[str, str] = {}
                if tier_ids:
                    tiers_res = (
                        _table(client, "academy", "tiers")
                        .select("id, name")
                        .in_("id", tier_ids)
                        .execute()
                    )
                    tiers_by_id = {
                        r["id"]: r["name"] for r in ((tiers_res and tiers_res.data) or []) if r.get("id")
                    }

                # Preserve order of completion (most recent first)
                for row in completed_rows:
                    lesson = lessons_by_id.get(row.get("lesson_id") or "")
                    if lesson:
                        recent_lessons_detail.append({
                            "title": lesson.get("title"),
                            "tier_name": tiers_by_id.get(lesson.get("tier_id") or "", ""),
                        })

            academy_progress = {
                "completed": total_completed,
                "total": total_lessons,
                "recent_lessons": recent_lessons_detail,
            }
    except Exception:
        logger.exception("DB query failed: academy progress for user_id=%s", user_id)

    # ── NEW BLOCK 12: Recent chat summaries ───────────────────────────────────
    # ai.chats.user_id FK → core.users(id), so we must use core_user_id here —
    # NOT the auth_id used for meridian.* tables.
    recent_chat_summaries: List[Dict[str, Any]] = []
    try:
        if not core_user_id:
            recent_chats: List[Dict[str, Any]] = []
        else:
            chats_res = (
                _table(client, "ai", "chats")
                .select("id, title")
                .eq("user_id", core_user_id)
                .order("updated_at", desc=True)
                .limit(3)
                .execute()
            )
            recent_chats = (chats_res and chats_res.data) or []

        if recent_chats:
            chat_ids = [c["id"] for c in recent_chats if c.get("id")]

            # Bulk-fetch all assistant messages for those 3 chats
            msgs_res = (
                _table(client, "ai", "chat_messages")
                .select("chat_id, role, content, created_at")
                .in_("chat_id", chat_ids)
                .eq("role", "assistant")
                .order("created_at", desc=True)
                .execute()
            )
            all_msgs = (msgs_res and msgs_res.data) or []

            # Index last assistant message per chat (msgs are already DESC by created_at)
            last_msg_by_chat: Dict[str, str] = {}
            for msg in all_msgs:
                cid = msg.get("chat_id")
                if cid and cid not in last_msg_by_chat:
                    last_msg_by_chat[cid] = msg.get("content") or ""

            for chat in recent_chats:
                cid = chat.get("id")
                last_msg = last_msg_by_chat.get(cid or "")
                if last_msg:
                    recent_chat_summaries.append({
                        "title": chat.get("title"),
                        "last_assistant_message": last_msg,
                    })
    except Exception:
        logger.exception("DB query failed: recent chat summaries for user_id=%s", user_id)

    # ── NEW BLOCK 13: User insights from memory extraction agent ─────────────
    user_insights: List[Dict[str, Any]] = []
    try:
        insights_res = (
            _table(client, "meridian", "user_insights")
            .select("insight_type, key, value, confidence, extracted_at")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .gte("confidence", 0.75)
            .order("confidence", desc=True)
            .order("extracted_at", desc=True)
            .limit(20)
            .execute()
        )
        for insight in ((insights_res and insights_res.data) or []):
            extracted_at = insight.get("extracted_at")
            if hasattr(extracted_at, "isoformat"):
                extracted_at = extracted_at.isoformat()
            user_insights.append({
                "insight_type": insight.get("insight_type"),
                "key": insight.get("key"),
                "value": insight.get("value"),
                "confidence": insight.get("confidence"),
                "extracted_at": str(extracted_at) if extracted_at else None,
            })
    except Exception:
        logger.warning("Could not fetch user_insights for user_id=%s", user_id)

    # 9. Compute plan status from goals (retained for backward compatibility)
    on_track_goals = []
    off_track_goals = []
    for goal in goals:
        monthly_contribution = goal.get("monthly_contribution")
        if monthly_contribution is None:
            on_track_goals.append(goal["goal_name"])
        elif float(monthly_contribution) > 0:
            on_track_goals.append(goal["goal_name"])
        else:
            off_track_goals.append(goal["goal_name"])

    plan_status: Dict[str, Any] = {
        "summary": _build_plan_summary(goals, on_track_goals, off_track_goals),
        "on_track": len(off_track_goals) == 0,
        "on_track_goals": on_track_goals,
        "off_track_goals": off_track_goals,
        "total_goals": len(goals),
    }

    # 10. Compute emergency fund status
    emergency_months = float(profile.get("emergency_fund_months") or 0)
    if emergency_months >= 6:
        ef_status = "Adequate (6+ months)"
    elif emergency_months >= 3:
        ef_status = f"Building ({emergency_months} months — target is 6)"
    elif emergency_months > 0:
        ef_status = f"Underfunded ({emergency_months} months — priority: build to 6)"
    else:
        ef_status = "None — building an emergency fund should come before investing"

    # 11. Build profile summary (merges core.user_profiles + core.users)
    profile_summary: Dict[str, Any] = {
        "risk_profile": profile.get("risk_profile", "not set"),
        "investment_horizon": profile.get("investment_horizon", "not set"),
        "monthly_investable": profile.get("monthly_investable"),
        "emergency_fund_status": ef_status,
        "income_range": profile.get("income_range"),
        "age_range": profile.get("age_range"),
        # From core.users — surfaces identity + declared preferences so IRIS
        # can address the user by name and tailor advice to their stated goals.
        "first_name": core_user_row.get("first_name"),
        "last_name": core_user_row.get("last_name"),
        "age": core_user_row.get("age"),
        "experience_level": core_user_row.get("experience_level"),
        "risk_level": core_user_row.get("risk_level"),
        "investment_goal": core_user_row.get("investment_goal"),
        "marital_status": core_user_row.get("marital_status"),
    }

    # 12. Format goals for context injection
    active_goals: List[Dict[str, Any]] = []
    for g in goals:
        target_amount = float(g.get("target_amount") or 0)
        current_amount = float(g.get("current_amount") or 0)
        progress_pct = (
            (current_amount / target_amount * 100) if target_amount > 0 else 0
        )
        target_date = g.get("target_date")
        if hasattr(target_date, "isoformat"):
            target_date = target_date.isoformat()
        active_goals.append({
            "goal_name": g.get("goal_name"),
            "target_amount": str(target_amount),
            "current_amount": str(current_amount),
            "progress_pct": round(progress_pct, 2),
            "target_date": str(target_date) if target_date else None,
            "monthly_contribution": str(g.get("monthly_contribution")) if g.get("monthly_contribution") else None,
            "status": g.get("status", "active"),
        })

    # 13. Format alerts
    active_alerts: List[Dict[str, Any]] = []
    for a in alerts:
        active_alerts.append({
            "alert_type": a.get("alert_type"),
            "severity": a.get("severity"),
            "message": a.get("message"),
        })

    # 14. Upsert into ai.iris_context_cache
    knowledge_tier = profile.get("knowledge_tier") if profile.get("knowledge_tier") is not None else 1

    cache_data: Dict[str, Any] = {
        "user_id": user_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "profile_summary": profile_summary,
        "active_goals": active_goals,
        "active_alerts": active_alerts,
        "plan_status": plan_status,
        "knowledge_tier": knowledge_tier,
        "financial_plan": financial_plan,
        "goal_progress_summary": goal_progress_summary,
        "intelligence_digest": intelligence_digest,
        "life_events": life_events,
        "user_positions": user_positions,
        # New context blocks (10-13)
        "trading_positions": trading_positions,
        "closed_trades": closed_trades,
        "portfolio_stats": portfolio_stats_str,
        "academy_progress": academy_progress,
        "recent_chat_summaries": recent_chat_summaries,
        "user_insights": user_insights,
    }

    try:
        _table(client, "ai", "iris_context_cache").upsert(
            cache_data,
            on_conflict="user_id",
        ).execute()
    except Exception:
        logger.exception("DB query failed: ai.iris_context_cache UPSERT for user_id=%s", user_id)
        raise

    return True


async def refresh_iris_context_cache(user_id: str) -> None:
    """
    Reads core.user_profiles + meridian.user_goals + meridian.risk_alerts,
    computes enriched context, upserts ai.iris_context_cache.
    Logs success at INFO, failure at ERROR. Never raises.
    """
    if not user_id:
        return
    try:
        await asyncio.to_thread(_refresh_iris_context_cache_sync, user_id)
        logger.info("Refreshed ai.iris_context_cache for user_id=%s", user_id)
    except Exception as exc:
        logger.error("Failed to refresh ai.iris_context_cache for user_id=%s: %s", user_id, exc)


def _refresh_all_users_sync() -> Dict[str, int]:
    """Sync implementation of daily refresh for all users."""
    client = supabase_client
    if not client:
        logger.error("Cannot run daily refresh — Supabase client not configured")
        return {"total": 0, "success": 0, "failed": 0}

    try:
        res = (
            _table(client, "core", "user_profiles")
            .select("user_id")
            .execute()
        )
        user_ids = [row["user_id"] for row in ((res and res.data) or [])]
    except Exception:
        logger.exception("Failed to fetch user_ids for daily refresh")
        return {"total": 0, "success": 0, "failed": 0}

    total = len(user_ids)
    success = 0
    failed = 0

    for uid in user_ids:
        try:
            _refresh_iris_context_cache_sync(uid)
            success += 1
        except Exception:
            failed += 1

    logger.info("Daily Meridian refresh complete: total=%d success=%d failed=%d", total, success, failed)
    return {"total": total, "success": success, "failed": failed}


async def refresh_all_users_context() -> Dict[str, int]:
    """
    Daily job: refresh ai.iris_context_cache for every user in core.user_profiles.
    Runs in a thread to avoid blocking the event loop.
    """
    return await asyncio.to_thread(_refresh_all_users_sync)


# ── Knowledge tier persistence ───────────────────────────────────────────────

def _update_knowledge_tier_sync(user_id: str, tier: int) -> None:
    """Persist detected knowledge tier to core.user_profiles and ai.iris_context_cache."""
    client = supabase_client
    if not client:
        return

    try:
        _table(client, "core", "user_profiles").update(
            {"knowledge_tier": tier}
        ).eq("user_id", user_id).execute()
    except Exception:
        logger.warning("Failed to update knowledge_tier in core.user_profiles for user_id=%s", user_id)

    try:
        _table(client, "ai", "iris_context_cache").update(
            {"knowledge_tier": tier}
        ).eq("user_id", user_id).execute()
    except Exception:
        logger.warning("Failed to update knowledge_tier in ai.iris_context_cache for user_id=%s", user_id)


async def update_knowledge_tier(user_id: str, tier: int) -> None:
    """Async wrapper for tier persistence. Never raises."""
    if not user_id or tier not in (1, 2, 3):
        return
    if os.getenv("ENVIRONMENT", "").lower() == "test":
        return
    try:
        await asyncio.to_thread(_update_knowledge_tier_sync, user_id, tier)
    except Exception as exc:
        logger.debug("Knowledge tier update failed for user %s: %s", user_id, exc)


# ── Onboarding (legacy endpoint support) ─────────────────────────────────────

def _onboard_user_sync(user_id: str, body: Dict[str, Any]) -> None:
    """
    Upserts core.user_profiles, inserts meridian.user_goals (skip if same goal_name + active exists),
    inserts meridian.meridian_events.
    """
    client = supabase_client
    if not client:
        raise ValueError("Supabase client not configured")

    profile_fields = {
        "knowledge_tier",
        "risk_profile",
        "investment_horizon",
        "monthly_investable",
        "emergency_fund_months",
    }
    profile_data: Dict[str, Any] = {"user_id": user_id}
    for k in profile_fields:
        if k in body and body[k] is not None:
            profile_data[k] = body[k]

    existing = (
        _table(client, "core", "user_profiles")
        .select("id")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if existing is not None and existing.data:
        update_payload = {k: v for k, v in profile_data.items() if k != "user_id"}
        if update_payload:
            (
                _table(client, "core", "user_profiles")
                .update(update_payload)
                .eq("id", existing.data["id"])
                .execute()
            )
    else:
        _table(client, "core", "user_profiles").insert(profile_data).execute()

    goal_name = body.get("goal_name")
    target_amount = body.get("target_amount")
    if goal_name is not None and target_amount is not None:
        existing_goal = (
            _table(client, "meridian", "user_goals")
            .select("id")
            .eq("user_id", user_id)
            .eq("goal_name", goal_name)
            .eq("status", "active")
            .maybe_single()
            .execute()
        )
        if existing_goal is None or not existing_goal.data:
            goal_row: Dict[str, Any] = {
                "user_id": user_id,
                "goal_name": goal_name,
                "target_amount": target_amount,
                "status": "active",
            }
            if body.get("target_date") is not None:
                goal_row["target_date"] = body["target_date"]
            _table(client, "meridian", "user_goals").insert(goal_row).execute()

    try:
        _table(client, "meridian", "meridian_events").insert({
            "user_id": user_id,
            "event_type": "onboarding_completed",
            "event_data": body,
            "source": "user_declared",
        }).execute()
    except Exception:
        logger.warning("Failed to log meridian_event for user_id=%s (non-critical)", user_id)


async def run_meridian_onboard(user_id: str, body: Dict[str, Any]) -> None:
    """Runs onboarding (profile upsert, goal insert, event log) in a thread. May raise."""
    await asyncio.to_thread(_onboard_user_sync, user_id, body)
