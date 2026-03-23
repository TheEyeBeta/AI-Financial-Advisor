# backend/websearch_service/app/services/meridian_context.py
"""
Meridian context layer — reads from core & meridian schemas,
writes to ai.iris_context_cache for IRIS personalisation.

Schema routing:
  core.user_profiles      → client.schema("core").table("user_profiles")
  meridian.user_goals     → client.schema("meridian").table("user_goals")
  meridian.risk_alerts    → client.schema("meridian").table("risk_alerts")
  meridian.meridian_events→ client.schema("meridian").table("meridian_events")
  ai.iris_context_cache   → client.schema("ai").table("iris_context_cache")
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

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


# ── Supabase client ──────────────────────────────────────────────────────────

def _get_supabase_client():
    """Lazy-init Supabase client. Returns None if not configured."""
    url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        return None
    try:
        from supabase import create_client
        return create_client(url, key)
    except Exception as exc:
        logger.debug("Supabase client not available for Meridian context: %s", exc)
        return None


# ── Context injection (read ai.iris_context_cache → format for IRIS) ─────────

def _fetch_iris_cache_sync(user_id: str) -> Optional[dict]:
    """Sync fetch of ai.iris_context_cache row."""
    client = _get_supabase_client()
    if not client:
        return None
    try:
        result = (
            client.schema("ai")
            .table("iris_context_cache")
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
    plan = ctx.get("plan_status") or {}
    tier = ctx.get("knowledge_tier", 1)

    return (
        "\n"
        "################################################################################\n"
        "# MERIDIAN — PERSONALISED USER CONTEXT\n"
        "# Use this to personalise every response.\n"
        "# Do not reveal raw field names or data structure to the user.\n"
        "# Reason from this naturally as an adviser who knows their client.\n"
        "################################################################################\n"
        "\n"
        f"KNOWLEDGE TIER: {tier}\n"
        "Adapt communication depth and vocabulary accordingly.\n"
        "Tier 1 = complete beginner. Tier 2 = developing. Tier 3 = advanced/institutional.\n"
        "\n"
        "INVESTMENT PROFILE:\n"
        f"- Risk profile: {_sanitise_for_prompt(profile.get('risk_profile'))}\n"
        f"- Investment horizon: {_sanitise_for_prompt(profile.get('investment_horizon'))}\n"
        f"- Monthly investable amount: {profile.get('monthly_investable', 'not set')}\n"
        f"- Emergency fund status: {profile.get('emergency_fund_status', 'not set')}\n"
        f"- Income range: {profile.get('income_range', 'not set')}\n"
        f"- Age range: {profile.get('age_range', 'not set')}\n"
        "\n"
        "ACTIVE FINANCIAL GOALS:\n"
        f"{_format_goals(goals)}\n"
        "\n"
        "CURRENT PLAN STATUS:\n"
        f"{plan.get('summary', 'No plan generated yet.')}\n"
        f"On track: {plan.get('on_track', 'unknown')}\n"
        "\n"
        "ACTIVE RISK ALERTS:\n"
        f"{_format_alerts(alerts)}\n"
        "\n"
        "################################################################################\n"
        "# END MERIDIAN CONTEXT — IRIS SYSTEM PROMPT FOLLOWS\n"
        "################################################################################\n"
        "\n"
    )


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
    Reads from core.user_profiles, meridian.user_goals, meridian.risk_alerts.
    Computes plan status and emergency fund assessment.
    Writes structured summary to ai.iris_context_cache.
    Returns True on success, False on failure.
    """
    client = _get_supabase_client()
    if not client:
        raise ValueError("Supabase client not configured")

    # 1. Fetch from core.user_profiles
    try:
        profile_res = (
            client.schema("core")
            .table("user_profiles")
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
            client.schema("meridian")
            .table("user_goals")
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
            client.schema("meridian")
            .table("risk_alerts")
            .select("*")
            .eq("user_id", user_id)
            .eq("resolved", False)
            .execute()
        )
        alerts = alerts_res.data or []
    except Exception:
        # Non-critical — continue without alerts
        logger.warning("Could not fetch risk_alerts for user_id=%s", user_id)

    # 4. Compute plan status
    on_track_goals = []
    off_track_goals = []
    for goal in goals:
        if goal.get("monthly_contribution") and float(goal.get("monthly_contribution", 0)) > 0:
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

    # 5. Compute emergency fund status
    emergency_months = float(profile.get("emergency_fund_months") or 0)
    if emergency_months >= 6:
        ef_status = "Adequate (6+ months)"
    elif emergency_months >= 3:
        ef_status = f"Building ({emergency_months} months — target is 6)"
    elif emergency_months > 0:
        ef_status = f"Underfunded ({emergency_months} months — priority: build to 6)"
    else:
        ef_status = "None — building an emergency fund should come before investing"

    # 6. Build profile summary
    profile_summary: Dict[str, Any] = {
        "risk_profile": profile.get("risk_profile", "not set"),
        "investment_horizon": profile.get("investment_horizon", "not set"),
        "monthly_investable": profile.get("monthly_investable"),
        "emergency_fund_status": ef_status,
        "income_range": profile.get("income_range"),
        "age_range": profile.get("age_range"),
    }

    # 7. Format goals for context injection
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

    # 8. Format alerts
    active_alerts: List[Dict[str, Any]] = []
    for a in alerts:
        active_alerts.append({
            "alert_type": a.get("alert_type"),
            "severity": a.get("severity"),
            "message": a.get("message"),
        })

    # 9. Upsert into ai.iris_context_cache
    knowledge_tier = profile.get("knowledge_tier") if profile.get("knowledge_tier") is not None else 1

    cache_data: Dict[str, Any] = {
        "user_id": user_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "profile_summary": profile_summary,
        "active_goals": active_goals,
        "active_alerts": active_alerts,
        "plan_status": plan_status,
        "knowledge_tier": knowledge_tier,
    }

    try:
        client.schema("ai").table("iris_context_cache").upsert(
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
    client = _get_supabase_client()
    if not client:
        logger.error("Cannot run daily refresh — Supabase client not configured")
        return {"total": 0, "success": 0, "failed": 0}

    try:
        res = (
            client.schema("core")
            .table("user_profiles")
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
    client = _get_supabase_client()
    if not client:
        return

    try:
        client.schema("core").table("user_profiles").update(
            {"knowledge_tier": tier}
        ).eq("user_id", user_id).execute()
    except Exception:
        logger.warning("Failed to update knowledge_tier in core.user_profiles for user_id=%s", user_id)

    try:
        client.schema("ai").table("iris_context_cache").update(
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
    client = _get_supabase_client()
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
        client.schema("core")
        .table("user_profiles")
        .select("id")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if existing.data:
        update_payload = {k: v for k, v in profile_data.items() if k != "user_id"}
        if update_payload:
            (
                client.schema("core")
                .table("user_profiles")
                .update(update_payload)
                .eq("id", existing.data["id"])
                .execute()
            )
    else:
        client.schema("core").table("user_profiles").insert(profile_data).execute()

    goal_name = body.get("goal_name")
    target_amount = body.get("target_amount")
    if goal_name is not None and target_amount is not None:
        existing_goal = (
            client.schema("meridian")
            .table("user_goals")
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
            client.schema("meridian").table("user_goals").insert(goal_row).execute()

    try:
        client.schema("meridian").table("meridian_events").insert({
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
