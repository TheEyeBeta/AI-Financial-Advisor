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
        return result.data if result.data else None
    except Exception:
        logger.exception("DB query failed: ai.iris_context_cache SELECT for user_id=%s", user_id)
        return None


async def build_iris_context(user_id: Optional[str]) -> str:
    """
    Fetches user's Meridian context from ai.iris_context_cache.
    Returns a formatted string prepended to FINANCIAL_ADVISOR_SYSTEM_PROMPT.

    GRACEFUL DEGRADATION: Any failure returns "" so IRIS always works.
    """
    if not user_id:
        return ""

    try:
        data = await asyncio.to_thread(_fetch_iris_cache_sync, user_id)
        if not data:
            return ""
        return _format_context_block(data)
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

    parts: List[str] = []

    # ── 1. User profile + 2. Knowledge tier + 3. Investment profile ──────────
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
        f"- Age range: {profile.get('age_range', 'not set')}\n"
        f"- Income range: {profile.get('income_range', 'not set')}\n"
        f"- Emergency fund status: {profile.get('emergency_fund_status', 'not set')}\n"
        "\n"
        f"KNOWLEDGE TIER: {tier}\n"
        "Adapt communication depth and vocabulary accordingly.\n"
        "Tier 1 = complete beginner. Tier 2 = developing. Tier 3 = advanced/institutional.\n"
        "\n"
        "INVESTMENT PROFILE:\n"
        f"- Risk profile: {_sanitise_for_prompt(profile.get('risk_profile'))}\n"
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
        profile = profile_res.data or {}
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
        goals = goals_res.data or []
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
        alerts = alerts_res.data or []
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
        fp_rows = fp_res.data or []
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
            gp_records = gp_res.data or []
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
        digest_rows = digest_res.data or []
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
        for le in (le_res.data or []):
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
        for pos in (pos_res.data or []):
            user_positions.append({
                "ticker": pos.get("ticker"),
                "quantity": pos.get("quantity"),
                "avg_cost": pos.get("avg_cost"),
                "current_value": pos.get("current_value"),
            })
    except Exception:
        logger.exception("DB query failed: meridian.user_positions SELECT for user_id=%s", user_id)

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

    # 11. Build profile summary
    profile_summary: Dict[str, Any] = {
        "risk_profile": profile.get("risk_profile", "not set"),
        "investment_horizon": profile.get("investment_horizon", "not set"),
        "monthly_investable": profile.get("monthly_investable"),
        "emergency_fund_status": ef_status,
        "income_range": profile.get("income_range"),
        "age_range": profile.get("age_range"),
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
        user_ids = [row["user_id"] for row in (res.data or [])]
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
    if existing.data:
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
        if not existing_goal.data:
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
