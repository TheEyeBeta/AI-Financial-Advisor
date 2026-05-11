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
import json
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)


_LEGACY_OPTIONAL_IRIS_CACHE_COLUMNS = {
    "journal_summary",
    "portfolio_stats",
    "achievement_summary",
}


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


def _humanise_profile_label(value: Any) -> Optional[str]:
    """Convert stored enum-like profile values into user-facing labels."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.replace("_", " ").replace("-", " ").title()


def _has_context_value(value: Any) -> bool:
    """Return True for values worth injecting into the prompt."""
    if value is None:
        return False
    if isinstance(value, str):
        text = value.strip()
        return bool(text) and text.lower() != "not set"
    if isinstance(value, (list, dict, tuple, set)):
        return bool(value)
    return True


def _format_currency_amount(value: Any) -> str:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return _sanitise_for_prompt(value, max_length=60)
    if amount.is_integer():
        return f"€{amount:,.0f}"
    return f"€{amount:,.2f}"


def _format_percent_value(value: Any) -> str:
    try:
        pct = float(value)
    except (TypeError, ValueError):
        return _sanitise_for_prompt(value, max_length=30)
    if pct.is_integer():
        return f"{pct:.0f}%"
    return f"{pct:.1f}%"


def _append_context_line(
    lines: List[str],
    label: str,
    value: Any,
    *,
    max_length: int = 100,
    formatter=None,
) -> None:
    if not _has_context_value(value):
        return
    if formatter is not None:
        rendered = formatter(value)
    else:
        rendered = _sanitise_for_prompt(value, max_length=max_length)
    if _has_context_value(rendered):
        lines.append(f"- {label}: {rendered}")


def _calculate_age_from_dob(dob: Any, today: Optional[date] = None) -> Optional[int]:
    """Calculate age from a date_of_birth value if one is present."""
    if not dob:
        return None
    try:
        if isinstance(dob, datetime):
            dob_date = dob.date()
        elif isinstance(dob, date):
            dob_date = dob
        else:
            dob_date = date.fromisoformat(str(dob).strip()[:10])
        today_date = today or datetime.now(timezone.utc).date()
        age = today_date.year - dob_date.year
        if (today_date.month, today_date.day) < (dob_date.month, dob_date.day):
            age -= 1
        return age if 0 <= age <= 150 else None
    except Exception:
        return None


def _resolve_age(age_value: Any, dob_value: Any = None) -> Optional[int]:
    age_from_dob = _calculate_age_from_dob(dob_value)
    if age_from_dob is not None:
        return age_from_dob
    if age_value in (None, ""):
        return None
    try:
        return int(age_value)
    except (TypeError, ValueError):
        return None


def _normalise_position_type(value: Any) -> str:
    return _sanitise_for_prompt(value, max_length=10).replace("_", " ").title()


def _derive_financial_literacy_level(knowledge_tier: Any) -> Optional[str]:
    try:
        tier = int(knowledge_tier)
    except (TypeError, ValueError):
        return None
    return {
        1: "Foundation",
        2: "Developing",
        3: "Advanced",
    }.get(tier)


def _extract_missing_postgrest_column(exc: Exception) -> Optional[str]:
    """Parse a PostgREST missing-column error into the missing column name."""
    message = str(exc)
    marker = "Could not find the '"
    if marker not in message:
        return None
    remainder = message.split(marker, 1)[1]
    return remainder.split("'", 1)[0] or None


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
# but a refresh is scheduled asynchronously in the background. The frontend
# triggers explicit refreshes after every relevant mutation, so this is the
# safety net for cold sessions / missed triggers — not the primary refresh
# path. Default 30 minutes balances freshness (a trade or completed lesson
# surfaces within half an hour) against churn (chatty sessions don't trigger
# a refresh on every turn). Override via IRIS_CACHE_STALE_MINUTES.
def _stale_after_minutes() -> int:
    raw = os.environ.get("IRIS_CACHE_STALE_MINUTES", "30")
    try:
        value = int(raw)
        return value if value > 0 else 30
    except (TypeError, ValueError):
        return 30


_CACHE_STALE_AFTER = timedelta(minutes=_stale_after_minutes())


def _is_cache_stale(updated_at: Any) -> bool:
    """Return True if the cache row's updated_at is older than the stale threshold.

    Re-reads IRIS_CACHE_STALE_MINUTES on each call so deploys / tests can
    change the threshold without restarting the process.
    """
    if not updated_at:
        return True
    try:
        if hasattr(updated_at, "isoformat"):
            ts = updated_at
        else:
            ts = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        threshold = timedelta(minutes=_stale_after_minutes())
        return (datetime.now(timezone.utc) - ts) > threshold
    except Exception:
        return True


def _schedule_background_refresh(user_id: str) -> None:
    """Fire-and-forget: kick off a full Meridian cache refresh without blocking."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(refresh_iris_context_cache(user_id))


# ── In-process cache for the formatted context block ─────────────────────────
# The Supabase row in ai.iris_context_cache is the durable cache; this is an
# extra layer in front of it so a chat session bursting messages does not pay
# the 50–100ms Supabase round-trip on every turn. Sub-millisecond hits make
# personalised context viable on INSTANT messages without measurable latency.
# Eviction: explicit refresh writes always invalidate the matching key.
_LOCAL_TTL_SECONDS = float(os.environ.get("IRIS_LOCAL_CACHE_TTL_SECONDS", "60"))
_LOCAL_CACHE_MAX_ENTRIES = 1024  # bounded so a runaway worker can't OOM
_local_cache: Dict[str, Tuple[float, str]] = {}


def _local_cache_get(user_id: str) -> Optional[str]:
    entry = _local_cache.get(user_id)
    if not entry:
        return None
    written_at, value = entry
    if (time.monotonic() - written_at) >= _LOCAL_TTL_SECONDS:
        _local_cache.pop(user_id, None)
        return None
    return value


def _local_cache_set(user_id: str, value: str) -> None:
    if len(_local_cache) >= _LOCAL_CACHE_MAX_ENTRIES:
        # Evict the oldest entry — simple O(n) sweep, fine at this size.
        oldest = min(_local_cache.items(), key=lambda kv: kv[1][0])[0]
        _local_cache.pop(oldest, None)
    _local_cache[user_id] = (time.monotonic(), value)


def _local_cache_evict(user_id: str) -> None:
    _local_cache.pop(user_id, None)


async def build_iris_context(user_id: Optional[str]) -> str:
    """
    Fetches user's Meridian context from ai.iris_context_cache.
    Returns a formatted string prepended to FINANCIAL_ADVISOR_SYSTEM_PROMPT.

    Two-layer cache:
      1. In-process (60s TTL by default) — sub-ms hits across a chat burst.
      2. Supabase ai.iris_context_cache — durable across processes / replicas.

    Non-blocking policy on layer 2:
      - Fresh cache hit  → serve it.
      - Stale cache hit  → serve it, schedule async refresh.
      - Cache miss       → serve minimal context from core.users, schedule async refresh.
    The chat pipeline is never blocked by a full 13-table rebuild.

    GRACEFUL DEGRADATION: Any failure returns "" so IRIS always works.
    """
    if not user_id:
        return ""

    cached = _local_cache_get(user_id)
    if cached is not None:
        return cached

    try:
        data = await asyncio.to_thread(_fetch_iris_cache_sync, user_id)

        if data:
            if _is_cache_stale(data.get("updated_at")):
                logger.info("IRIS cache stale for user %s — scheduling async refresh", user_id)
                _schedule_background_refresh(user_id)
            block = _format_context_block(data)
            _local_cache_set(user_id, block)
            return block

        # Cache miss — never block the chat. Build a minimal context from
        # core.users (name + tier) so IRIS still greets the user personally,
        # then kick off a full refresh in the background.
        logger.info("IRIS cache miss for user %s — scheduling async refresh", user_id)
        _schedule_background_refresh(user_id)

        minimal = await asyncio.to_thread(_build_minimal_context_sync, user_id)
        result = minimal or ""
        if result:
            _local_cache_set(user_id, result)
        return result
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
    journal_summary = ctx.get("journal_summary") or "No journal entries yet"
    achievement_summary = ctx.get("achievement_summary") or "None yet"
    academy_progress = ctx.get("academy_progress") or {}
    recent_chat_summaries = ctx.get("recent_chat_summaries") or []
    user_insights = ctx.get("user_insights") or []

    parts: List[str] = []

    # ── 1. User profile + 2. Knowledge tier + 3. Investment profile ──────────
    first_name = _sanitise_for_prompt(profile.get("first_name"), max_length=40)
    last_name = _sanitise_for_prompt(profile.get("last_name"), max_length=40)
    name_parts = [p for p in (first_name, last_name) if p and p != "not set"]
    display_name = " ".join(name_parts) if name_parts else "not set"
    age_value = _resolve_age(profile.get("age"), profile.get("date_of_birth"))

    profile_lines = ["USER PROFILE:"]
    _append_context_line(profile_lines, "Name", display_name if display_name != "not set" else None)
    _append_context_line(profile_lines, "Age", age_value)
    _append_context_line(profile_lines, "Age range", profile.get("age_range"), max_length=30)
    _append_context_line(profile_lines, "Country of residence", profile.get("country_of_residence"), max_length=60)
    _append_context_line(profile_lines, "Marital status", profile.get("marital_status"), max_length=30)
    _append_context_line(profile_lines, "Employment status", profile.get("employment_status"), max_length=40)
    _append_context_line(profile_lines, "Dependants", profile.get("dependants"))
    _append_context_line(profile_lines, "Occupation", profile.get("occupation"), max_length=60)
    _append_context_line(profile_lines, "Income source", profile.get("income_source"), max_length=80)
    _append_context_line(profile_lines, "Experience level", profile.get("experience_level"), max_length=30)

    investment_lines = ["INVESTMENT PROFILE:"]
    _append_context_line(investment_lines, "Investment goal", profile.get("investment_goal"), max_length=40)
    _append_context_line(investment_lines, "Income range", profile.get("income_range"), max_length=40)
    _append_context_line(
        investment_lines,
        "Monthly expenses",
        profile.get("monthly_expenses"),
        formatter=_format_currency_amount,
    )
    _append_context_line(
        investment_lines,
        "Total debt",
        profile.get("total_debt"),
        formatter=_format_currency_amount,
    )
    _append_context_line(
        investment_lines,
        "Net worth",
        profile.get("net_worth"),
        formatter=_format_currency_amount,
    )
    _append_context_line(investment_lines, "Emergency fund status", profile.get("emergency_fund_status"))
    _append_context_line(investment_lines, "Risk profile", profile.get("risk_profile"))
    _append_context_line(investment_lines, "Risk level", profile.get("risk_level"), max_length=30)
    _append_context_line(investment_lines, "Investment horizon", profile.get("investment_horizon"))
    _append_context_line(
        investment_lines,
        "Monthly investable amount",
        profile.get("monthly_investable"),
        formatter=_format_currency_amount,
    )
    profile_block = "\n".join(profile_lines)
    investment_block = "\n".join(investment_lines)

    parts.append(
        "\n"
        "################################################################################\n"
        "# MERIDIAN — PERSONALISED USER CONTEXT\n"
        "# Use this to personalise every response.\n"
        "# Do not reveal raw field names or data structure to the user.\n"
        "# Reason from this naturally as an adviser who knows their client.\n"
        "################################################################################\n"
        "\n"
        f"{profile_block}\n"
        "\n"
        f"KNOWLEDGE TIER: {tier}\n"
        "Adapt communication depth and vocabulary accordingly.\n"
        "Tier 1 = complete beginner. Tier 2 = developing. Tier 3 = advanced/institutional.\n"
        "\n"
        f"{investment_block}\n"
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

    parts.append(
        "\n"
        "TRADING BEHAVIOUR:\n"
        f"{_sanitise_for_prompt(journal_summary, max_length=300)}\n"
    )

    parts.append(
        "\n"
        "USER ACHIEVEMENTS:\n"
        f"{_sanitise_for_prompt(achievement_summary, max_length=300)}\n"
    )

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
            pos_type = _normalise_position_type(pos.get("type"))
            qty = pos.get("quantity", 0)
            entry = float(pos.get("entry_price") or 0)
            current = float(pos.get("current_price") or entry)
            pnl = float(pos.get("pnl_pct") or 0)
            pnl_str = f"+{pnl:.1f}%" if pnl >= 0 else f"{pnl:.1f}%"
            parts.append(
                f"{symbol}: {pos_type}, size {qty}, entry ${entry:,.2f}, "
                f"current P&L {pnl_str}\n"
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
    avg_return_pct: Optional[float] = None,
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
        if avg_return_pct is not None:
            lines.append(f"  Avg return: {avg_return_pct:+.1f}%")
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
    current_module = progress.get("current_module")
    current_lesson = progress.get("current_lesson")
    avg_quiz_score = progress.get("avg_quiz_score")
    literacy_level = progress.get("financial_literacy_level")

    summary_parts = [f"{completed}/{total} lessons complete"]
    if _has_context_value(current_module):
        summary_parts.append(
            f"current module: {_sanitise_for_prompt(current_module, max_length=60)}"
        )
    if _has_context_value(avg_quiz_score):
        summary_parts.append(f"avg quiz score: {_format_percent_value(avg_quiz_score)}")
    if _has_context_value(literacy_level):
        summary_parts.append(
            f"financial literacy level: {_sanitise_for_prompt(literacy_level, max_length=40)}"
        )

    parts = [
        "\n=== LEARNING PROGRESS ===\n",
        f"{', '.join(summary_parts)}.\n",
    ]

    if _has_context_value(current_lesson):
        parts.append(
            f"Current lesson: {_sanitise_for_prompt(current_lesson, max_length=80)}\n"
        )

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
        line = f"Recent topic: '{title}'"
        if snippet:
            line += f" — {snippet}"
        parts.append(f"{line}\n")
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
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        fp_rows = (fp_res and fp_res.data) or []
        if fp_rows:
            p = next((row for row in fp_rows if row.get("status") == "active"), None)
            if p is None:
                p = next((row for row in fp_rows if row.get("is_current") is True), fp_rows[0])

            plan_data = p.get("plan_data")
            plan_data = plan_data if isinstance(plan_data, dict) else {}
            target_amount = float(
                p.get("target_amount")
                or plan_data.get("target_amount")
                or 0
            )
            current_amount = float(
                p.get("current_amount")
                or plan_data.get("current_amount")
                or plan_data.get("saved_amount")
                or 0
            )
            pct = (current_amount / target_amount * 100) if target_amount > 0 else 0.0
            target_date = p.get("target_date") or plan_data.get("target_date")
            if hasattr(target_date, "isoformat"):
                target_date = target_date.isoformat()
            financial_plan = {
                "plan_name": p.get("plan_name") or plan_data.get("plan_name") or plan_data.get("name"),
                "target_amount": target_amount,
                "target_date": str(target_date) if target_date else None,
                "current_amount": current_amount,
                "status": p.get("status") or ("active" if p.get("is_current") is True else None),
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
                .select("goal_id, on_track")
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
            # content is stored as JSONB; convert to a plain string for the prompt
            raw_content = d.get("content")
            if isinstance(raw_content, (dict, list)):
                content_str = json.dumps(raw_content)
            else:
                content_str = str(raw_content) if raw_content is not None else None
            intelligence_digest = {
                "digest_type": d.get("digest_type"),
                "content": content_str,
                "created_at": str(created_at) if created_at else None,
            }
    except Exception:
        logger.exception("DB query failed: meridian.intelligence_digests SELECT for user_id=%s", user_id)

    # 7. Fetch life events within the next 90 days from meridian.life_events
    # The DB column is "notes"; we expose it as "description" for the formatter.
    life_events: List[Dict[str, Any]] = []
    try:
        now = datetime.now(timezone.utc)
        today_str = now.date().isoformat()
        cutoff_str = (now + timedelta(days=90)).date().isoformat()
        le_res = (
            _table(client, "meridian", "life_events")
            .select("event_type, event_date, notes")
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
                "description": le.get("notes"),  # DB column is "notes"
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
    journal_summary = "No journal entries yet"
    achievement_summary = "None yet"
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
            try:
                achievements_res = (
                    _table(client, "core", "achievements")
                    .select("name, unlocked_at")
                    .eq("user_id", core_user_id)
                    .order("unlocked_at", desc=True)
                    .limit(10)
                    .execute()
                )
                achievement_rows = (achievements_res and achievements_res.data) or []
                achievement_names = [
                    _sanitise_for_prompt(row.get("name"), max_length=60)
                    for row in achievement_rows
                    if row.get("name")
                ]
                if achievement_names:
                    achievement_summary = ", ".join(achievement_names)
            except Exception:
                logger.warning("Could not fetch core.achievements for user_id=%s", user_id)

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
                pos_type = (pos.get("type") or "").upper()
                if pos_type == "SHORT":
                    pnl_pct = (
                        (entry_price - current_price) / entry_price * 100
                        if entry_price > 0 else 0.0
                    )
                else:
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
    if core_user_id:
        try:
            journal_res = (
                _table(client, "trading", "trade_journal")
                .select("symbol, type, date, strategy")
                .eq("user_id", core_user_id)
                .order("date", desc=True)
                .limit(20)
                .execute()
            )
            journal_rows = (journal_res and journal_res.data) or []
            if journal_rows:
                strategies = [
                    _sanitise_for_prompt(row.get("strategy"), max_length=60)
                    for row in journal_rows
                    if row.get("strategy")
                ]
                symbols = [
                    _sanitise_for_prompt(row.get("symbol"), max_length=20)
                    for row in journal_rows
                    if row.get("symbol")
                ]
                buys = sum(1 for row in journal_rows if (row.get("type") or "").upper() == "BUY")
                sells = sum(1 for row in journal_rows if (row.get("type") or "").upper() == "SELL")
                top_strategy = max(set(strategies), key=strategies.count) if strategies else "none"
                top_symbols = list(dict.fromkeys(symbols))[:5]
                most_traded = ", ".join(top_symbols) if top_symbols else "none"
                journal_summary = (
                    f"Top strategy: {top_strategy} | "
                    f"Most traded: {most_traded} | "
                    f"BUY/SELL ratio: {buys}/{sells}"
                )
        except Exception:
            logger.warning("Could not fetch trading.trade_journal for user_id=%s", user_id)

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
                .select("pnl, type, entry_price, exit_price")
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
        return_pcts: List[float] = []
        for trade in all_closed_trades:
            entry_price = float(trade.get("entry_price") or 0)
            exit_price = float(trade.get("exit_price") or 0)
            if entry_price <= 0 or exit_price <= 0:
                continue
            trade_type = (trade.get("type") or "").upper()
            if trade_type == "SHORT":
                return_pcts.append((entry_price - exit_price) / entry_price * 100)
            else:
                return_pcts.append((exit_price - entry_price) / entry_price * 100)
        avg_return_pct: Optional[float] = (
            sum(return_pcts) / len(return_pcts) if return_pcts else None
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
            avg_return_pct=avg_return_pct,
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

            current_progress_res = (
                _table(client, "academy", "user_lesson_progress")
                .select("lesson_id, status, last_opened_at, best_quiz_score")
                .eq("user_id", core_user_id)
                .eq("status", "in_progress")
                .order("last_opened_at", desc=True)
                .limit(1)
                .execute()
            )
            current_progress_rows = (current_progress_res and current_progress_res.data) or []
            current_lesson_id = (
                current_progress_rows[0].get("lesson_id")
                if current_progress_rows else None
            )

            quiz_score_rows: List[Dict[str, Any]] = []
            try:
                quiz_scores_res = (
                    _table(client, "academy", "user_lesson_progress")
                    .select("best_quiz_score")
                    .eq("user_id", core_user_id)
                    .execute()
                )
                quiz_score_rows = (quiz_scores_res and quiz_scores_res.data) or []
            except Exception:
                logger.warning("Could not fetch academy.user_lesson_progress quiz scores for user_id=%s", user_id)

            quiz_scores = [
                float(row.get("best_quiz_score"))
                for row in quiz_score_rows
                if row.get("best_quiz_score") is not None
            ]
            if not quiz_scores:
                try:
                    quiz_attempts_res = (
                        _table(client, "academy", "quiz_attempts")
                        .select("score")
                        .eq("user_id", core_user_id)
                        .execute()
                    )
                    quiz_scores = [
                        float(row.get("score"))
                        for row in ((quiz_attempts_res and quiz_attempts_res.data) or [])
                        if row.get("score") is not None
                    ]
                except Exception:
                    logger.warning("Could not fetch academy.quiz_attempts for user_id=%s", user_id)
            avg_quiz_score = (
                round(sum(quiz_scores) / len(quiz_scores), 1) if quiz_scores else None
            )

            # Fetch lesson titles and tier_ids for recent completed + current lesson.
            recent_lesson_ids = [r["lesson_id"] for r in completed_rows if r.get("lesson_id")]
            lesson_ids = list(dict.fromkeys([
                *recent_lesson_ids,
                *([current_lesson_id] if current_lesson_id else []),
            ]))
            recent_lessons_detail: List[Dict[str, Any]] = []
            current_lesson_title: Optional[str] = None
            current_module_name: Optional[str] = None
            if lesson_ids:
                lessons_res = (
                    _table(client, "academy", "lessons")
                    .select("id, title, tier_id")
                    .in_("id", lesson_ids)
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

                if current_lesson_id:
                    current_lesson = lessons_by_id.get(current_lesson_id)
                    if current_lesson:
                        current_lesson_title = current_lesson.get("title")
                        current_module_name = tiers_by_id.get(
                            current_lesson.get("tier_id") or ""
                        )

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
                "current_lesson": current_lesson_title,
                "current_module": current_module_name,
                "avg_quiz_score": avg_quiz_score,
                "financial_literacy_level": _derive_financial_literacy_level(
                    profile.get("knowledge_tier")
                ),
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
                .limit(5)
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
                if last_msg or chat.get("title"):
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
    resolved_age = _resolve_age(
        core_user_row.get("age") or profile.get("age"),
        profile.get("date_of_birth"),
    )
    profile_summary: Dict[str, Any] = {
        "risk_profile": profile.get("risk_profile", "not set"),
        "investment_horizon": profile.get("investment_horizon", "not set"),
        "monthly_investable": profile.get("monthly_investable"),
        "emergency_fund_status": ef_status,
        "income_range": profile.get("income_range"),
        "age_range": profile.get("age_range"),
        # From core.users — surfaces identity + declared preferences so IRIS
        # can address the user by name and tailor advice to their stated goals.
        "monthly_expenses": profile.get("monthly_expenses"),
        "total_debt": profile.get("total_debt"),
        "dependants": profile.get("dependants"),
        "first_name": core_user_row.get("first_name"),
        "last_name": core_user_row.get("last_name"),
        "age": resolved_age,
        "date_of_birth": profile.get("date_of_birth"),
        "experience_level": core_user_row.get("experience_level"),
        "risk_level": core_user_row.get("risk_level"),
        "investment_goal": core_user_row.get("investment_goal"),
        "marital_status": _humanise_profile_label(
            core_user_row.get("marital_status") or profile.get("marital_status")
        ),
        "country_of_residence": profile.get("country_of_residence"),
        "employment_status": _humanise_profile_label(profile.get("employment_status")),
        "net_worth": profile.get("net_worth"),
        "occupation": profile.get("occupation"),
        "income_source": profile.get("income_source"),
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
        "journal_summary": journal_summary,
        "portfolio_stats": portfolio_stats_str,
        "achievement_summary": achievement_summary,
        "academy_progress": academy_progress,
        "recent_chat_summaries": recent_chat_summaries,
        "user_insights": user_insights,
    }

    upsert_payload = dict(cache_data)
    retryable_missing_columns = set(_LEGACY_OPTIONAL_IRIS_CACHE_COLUMNS)
    while True:
        try:
            _table(client, "ai", "iris_context_cache").upsert(
                upsert_payload,
                on_conflict="user_id",
            ).execute()
            break
        except Exception as exc:
            missing_column = _extract_missing_postgrest_column(exc)
            if (
                missing_column in retryable_missing_columns
                and missing_column in upsert_payload
            ):
                logger.warning(
                    "Legacy ai.iris_context_cache schema missing column %s for user_id=%s; retrying without it",
                    missing_column,
                    user_id,
                )
                upsert_payload.pop(missing_column, None)
                retryable_missing_columns.remove(missing_column)
                continue
            logger.exception("DB query failed: ai.iris_context_cache UPSERT for user_id=%s", user_id)
            raise

    # The Supabase row is now fresh — invalidate the in-process layer so the
    # next chat turn picks up the new data instead of serving stale strings
    # from the local TTL window.
    _local_cache_evict(user_id)
    return True


async def refresh_iris_context_cache(user_id: str) -> None:
    """
    Reads core.user_profiles + meridian.user_goals + meridian.risk_alerts,
    computes enriched context, upserts ai.iris_context_cache, and evicts
    the in-process cache so the next chat turn re-reads the fresh row.

    Logs success at INFO, failure at ERROR. Never raises.
    """
    if not user_id:
        return
    try:
        await asyncio.to_thread(_refresh_iris_context_cache_sync, user_id)
        _local_cache_evict(user_id)
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
