# backend/websearch_service/app/services/meridian_context.py
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _get_supabase_client():
    """Lazy-init Supabase client for iris_context_cache. Returns None if not configured."""
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


def _fetch_iris_cache_sync(user_id: str) -> Optional[dict]:
    """Sync fetch of iris_context_cache row. Returns None on failure or missing."""
    supabase = _get_supabase_client()
    if not supabase:
        return None
    result = (
        supabase.table("iris_context_cache")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return result.data if result.data else None


async def build_iris_context(user_id: Optional[str]) -> str:
    """
    Fetches user's Meridian context from Supabase iris_context_cache.
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
        f"- Risk profile: {profile.get('risk_profile', 'not set')}\n"
        f"- Investment horizon: {profile.get('investment_horizon', 'not set')}\n"
        f"- Monthly investable amount: {profile.get('monthly_investable', 'not set')}\n"
        f"- Emergency fund status: {profile.get('emergency_fund_status', 'not set')}\n"
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
        lines.append(
            f"- {g.get('goal_name', 'Unnamed goal')}: "
            f"€{g.get('current_amount', 0):,.0f} of "
            f"€{g.get('target_amount', 0):,.0f} "
            f"({progress:.0f}% complete) — "
            f"target date: {g.get('target_date', 'not set')}"
        )
    return "\n".join(lines)


def _format_alerts(alerts: list) -> str:
    if not alerts:
        return "No active alerts."
    lines = []
    for a in alerts:
        lines.append(
            f"- [{a.get('severity', 'info').upper()}] "
            f"{a.get('alert_type', '')}: {a.get('message', '')}"
        )
    return "\n".join(lines)


def _refresh_iris_context_cache_sync(user_id: str) -> None:
    """
    Sync implementation: read user_profiles + user_goals (active), build cache payload, upsert.
    Raises are allowed here; caller catches and logs.
    """
    supabase = _get_supabase_client()
    if not supabase:
        raise ValueError("Supabase client not configured")

    # user_profiles: one row per user_id (we use .eq("user_id", user_id).maybe_single())
    profile_res = (
        supabase.table("user_profiles")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    profile = profile_res.data or {}

    # user_goals: status = 'active'
    goals_res = (
        supabase.table("user_goals")
        .select("goal_name, target_amount, current_amount, target_date")
        .eq("user_id", user_id)
        .eq("status", "active")
        .execute()
    )
    goals_rows = goals_res.data or []

    emergency_fund_months = profile.get("emergency_fund_months")
    if emergency_fund_months is not None and emergency_fund_months >= 3:
        emergency_fund_status = "adequate (3+ months)"
    elif emergency_fund_months is not None and emergency_fund_months > 0:
        emergency_fund_status = f"building ({emergency_fund_months} months saved)"
    else:
        emergency_fund_status = "not yet established"

    profile_summary: Dict[str, Any] = {
        "risk_profile": profile.get("risk_profile"),
        "investment_horizon": profile.get("investment_horizon"),
        "monthly_investable": profile.get("monthly_investable"),
        "emergency_fund_status": emergency_fund_status,
    }

    active_goals: List[Dict[str, Any]] = []
    for g in goals_rows:
        target_amount = g.get("target_amount") or 0
        current_amount = g.get("current_amount") or 0
        progress_pct = (
            (float(current_amount) / float(target_amount) * 100)
            if target_amount and float(target_amount) > 0
            else 0
        )
        target_date = g.get("target_date")
        if hasattr(target_date, "isoformat"):
            target_date = target_date.isoformat()
        active_goals.append({
            "goal_name": g.get("goal_name"),
            "target_amount": target_amount,
            "current_amount": current_amount,
            "progress_pct": round(progress_pct, 2),
            "target_date": target_date,
        })

    plan_status: Dict[str, Any] = {
        "summary": "Profile and goals captured; plan not yet generated.",
        "on_track": True,
    }
    knowledge_tier = profile.get("knowledge_tier") if profile.get("knowledge_tier") is not None else 1

    row = {
        "user_id": user_id,
        "profile_summary": profile_summary,
        "active_goals": active_goals,
        "active_alerts": [],
        "plan_status": plan_status,
        "knowledge_tier": knowledge_tier,
    }

    supabase.table("iris_context_cache").upsert(
        row,
        on_conflict="user_id",
    ).execute()


async def refresh_iris_context_cache(user_id: str) -> None:
    """
    Reads user_profiles and active user_goals, computes progress_pct and emergency_fund_status,
    upserts iris_context_cache. Logs success at INFO, failure at ERROR. Never raises.
    """
    if not user_id:
        return
    try:
        await asyncio.to_thread(_refresh_iris_context_cache_sync, user_id)
        logger.info("Refreshed iris_context_cache for user_id=%s", user_id)
    except Exception as exc:
        logger.error("Failed to refresh iris_context_cache for user_id=%s: %s", user_id, exc)


def _onboard_user_sync(user_id: str, body: Dict[str, Any]) -> None:
    """
    Upserts user_profiles, inserts user_goals (skip if same goal_name + active exists),
    inserts meridian_events. Uses Supabase client from _get_supabase_client.
    """
    supabase = _get_supabase_client()
    if not supabase:
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
        supabase.table("user_profiles")
        .select("id")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if existing.data:
        update_payload = {k: v for k, v in profile_data.items() if k != "user_id"}
        if update_payload:
            supabase.table("user_profiles").update(update_payload).eq("id", existing.data["id"]).execute()
    else:
        supabase.table("user_profiles").insert(profile_data).execute()

    goal_name = body.get("goal_name")
    target_amount = body.get("target_amount")
    if goal_name is not None and target_amount is not None:
        existing_goal = (
            supabase.table("user_goals")
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
            supabase.table("user_goals").insert(goal_row).execute()

    supabase.table("meridian_events").insert({
        "user_id": user_id,
        "event_type": "onboarding_completed",
        "event_data": body,
        "source": "user_declared",
    }).execute()


async def run_meridian_onboard(user_id: str, body: Dict[str, Any]) -> None:
    """Runs onboarding (profile upsert, goal insert, event log) in a thread. May raise."""
    await asyncio.to_thread(_onboard_user_sync, user_id, body)
