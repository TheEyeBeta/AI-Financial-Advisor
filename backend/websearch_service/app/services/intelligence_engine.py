# backend/websearch_service/app/services/intelligence_engine.py
"""Proactive Intelligence Engine — scheduled digest generator.

Runs periodically (every 6 hours via APScheduler) to evaluate each active
user's Meridian data against market signals. Writes actionable digests to
meridian.intelligence_digests so IRIS always has something to say when a
user opens the app.

Design constraints
──────────────────
- NO LLM calls. All digest content is deterministic template strings.
- NO N+1 queries. All data is batch-fetched before the per-user loop.
- Run lock prevents overlapping cycles in a single-process deployment.
- No user PII is written to logs, even in error paths.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)

# ── Run lock (single-process guard against overlapping 6-hour cycles) ─────────
# NOTE: This is a simple in-process flag. If the service is scaled to multiple
# replicas, concurrent cycles can occur across replicas. For multi-replica
# safety, replace with a distributed lock (e.g. a Supabase advisory lock or
# Redis SETNX). For the current single-process deployment this is sufficient.
_cycle_running: bool = False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tbl(schema: str, table: str):
    """Return a schema-qualified table builder."""
    return supabase_client.schema(schema).table(table)


# ── Bulk data fetching ────────────────────────────────────────────────────────

def _fetch_active_users(cutoff_iso: str) -> list[dict]:
    """Return up to 500 core.users active (updated_at) within the last 30 days.

    Returns rows with both ``id`` (core.users PK) and ``auth_id`` (the
    Supabase auth UUID).  All meridian tables use auth_id as their user_id,
    so callers must use ``auth_id`` — NOT ``id`` — when querying meridian.
    """
    res = (
        _tbl("core", "users")
        .select("id, auth_id")
        .gte("updated_at", cutoff_iso)
        .limit(500)
        .execute()
    )
    return res.data or []


def _fetch_goals_by_user(user_ids: list[str]) -> dict[str, list[dict]]:
    """Batch fetch active user_goals, keyed by user_id."""
    result: dict[str, list[dict]] = {uid: [] for uid in user_ids}
    res = (
        _tbl("meridian", "user_goals")
        .select("id, user_id, goal_name, target_amount, current_amount, status")
        .in_("user_id", user_ids)
        .eq("status", "active")
        .execute()
    )
    for row in (res.data or []):
        uid = row.get("user_id")
        if uid in result:
            result[uid].append(row)
    return result


def _fetch_goal_progress(goal_ids: list[str]) -> dict[str, list[dict]]:
    """Batch fetch goal_progress rows, keyed by goal_id."""
    if not goal_ids:
        return {}
    result: dict[str, list[dict]] = {}
    res = (
        _tbl("meridian", "goal_progress")
        .select("goal_id, period, actual_amount, target_amount, on_track")
        .in_("goal_id", goal_ids)
        .order("period", desc=True)
        .execute()
    )
    for row in (res.data or []):
        gid = row.get("goal_id")
        if gid is not None:
            result.setdefault(gid, []).append(row)
    return result


def _fetch_alerts_by_user(user_ids: list[str]) -> dict[str, list[dict]]:
    """Batch fetch unresolved risk_alerts, keyed by user_id."""
    result: dict[str, list[dict]] = {uid: [] for uid in user_ids}
    res = (
        _tbl("meridian", "risk_alerts")
        .select("*")
        .in_("user_id", user_ids)
        .eq("resolved", False)
        .execute()
    )
    for row in (res.data or []):
        uid = row.get("user_id")
        if uid in result:
            result[uid].append(row)
    return result


def _fetch_positions_by_user(user_ids: list[str]) -> dict[str, list[dict]]:
    """Batch fetch open user_positions, keyed by user_id."""
    result: dict[str, list[dict]] = {uid: [] for uid in user_ids}
    res = (
        _tbl("meridian", "user_positions")
        .select("user_id, ticker, quantity")
        .in_("user_id", user_ids)
        .execute()
    )
    for row in (res.data or []):
        uid = row.get("user_id")
        if uid in result:
            result[uid].append(row)
    return result


def _fetch_plans_by_user(user_ids: list[str]) -> dict[str, dict | None]:
    """Batch fetch the most recent active financial_plan per user."""
    result: dict[str, dict | None] = {uid: None for uid in user_ids}
    res = (
        _tbl("meridian", "financial_plans")
        .select("user_id, plan_name, target_amount, current_amount, target_date")
        .in_("user_id", user_ids)
        .eq("status", "active")
        .order("created_at", desc=True)
        .execute()
    )
    # Since results are ordered newest-first, only keep the first plan per user.
    for row in (res.data or []):
        uid = row.get("user_id")
        if uid in result and result[uid] is None:
            result[uid] = row
    return result


def _fetch_unread_digest_types(user_ids: list[str]) -> dict[str, set[str]]:
    """
    Batch fetch existing unread digests (is_read = false).
    Returns a dict of user_id → set of digest_types that already have an unread entry.
    This is the gate used before every insert to prevent duplicates.
    """
    result: dict[str, set[str]] = {uid: set() for uid in user_ids}
    res = (
        _tbl("meridian", "intelligence_digests")
        .select("user_id, digest_type")
        .in_("user_id", user_ids)
        .eq("is_read", False)
        .execute()
    )
    for row in (res.data or []):
        uid = row.get("user_id")
        dtype = row.get("digest_type")
        if uid in result and dtype:
            result[uid].add(dtype)
    return result


def _fetch_announced_plan_milestones(user_ids: list[str]) -> dict[str, set[int]]:
    """
    Batch fetch all plan_milestone digests (read or unread) for each user.
    Parses the headline to determine which milestone percentages (25/50/75)
    have already been announced, preventing re-announcement on every cycle.
    """
    result: dict[str, set[int]] = {uid: set() for uid in user_ids}
    res = (
        _tbl("meridian", "intelligence_digests")
        .select("user_id, headline")
        .in_("user_id", user_ids)
        .eq("digest_type", "plan_milestone")
        .execute()
    )
    for row in (res.data or []):
        uid = row.get("user_id")
        if uid not in result:
            continue
        headline = row.get("headline") or ""
        for pct in (25, 50, 75):
            if f"is {pct}% complete" in headline:
                result[uid].add(pct)
                break  # a single digest can only announce one threshold
    return result


def _fetch_top_10_stocks() -> tuple[set[str], dict[str, float]]:
    """
    Fetch the top 10 tickers from market.stock_ranking_history using the
    most recent scored_at snapshot, ordered by composite_score desc.

    Returns:
        top_tickers: set of ticker strings in the top 10
        ticker_scores: dict of ticker → composite_score
    """
    top_tickers: set[str] = set()
    ticker_scores: dict[str, float] = {}

    # Step 1: find the most recent scored_at timestamp
    latest_res = (
        _tbl("market", "stock_ranking_history")
        .select("scored_at")
        .order("scored_at", desc=True)
        .limit(1)
        .execute()
    )
    latest_rows = latest_res.data or []
    if not latest_rows:
        return top_tickers, ticker_scores

    latest_scored_at = latest_rows[0]["scored_at"]

    # Step 2: fetch all rows from that snapshot (multiple horizons may exist),
    # then deduplicate by ticker keeping the highest composite_score.
    snap_res = (
        _tbl("market", "stock_ranking_history")
        .select("ticker, composite_score")
        .eq("scored_at", latest_scored_at)
        .execute()
    )
    # Deduplicate: keep highest composite_score per ticker
    best_by_ticker: dict[str, float] = {}
    for row in (snap_res.data or []):
        ticker = row.get("ticker")
        score = float(row.get("composite_score") or 0)
        if ticker and score > best_by_ticker.get(ticker, -1):
            best_by_ticker[ticker] = score

    # Pick top 10 by score
    sorted_tickers = sorted(best_by_ticker, key=lambda t: best_by_ticker[t], reverse=True)[:10]
    for ticker in sorted_tickers:
        top_tickers.add(ticker)
        ticker_scores[ticker] = best_by_ticker[ticker]

    return top_tickers, ticker_scores


# ── Per-user digest evaluation (pure function, no DB) ─────────────────────────

def _evaluate_user(
    *,
    alerts: list[dict],
    goals: list[dict],
    goal_progress_by_goal_id: dict[str, list[dict]],
    positions: list[dict],
    plan: dict | None,
    top_10_tickers: set[str],
    ticker_scores: dict[str, float],
    announced_milestones: set[int],
) -> dict[str, str] | None:
    """
    Evaluate the four digest conditions in priority order.
    Returns a digest dict (digest_type, headline, body) or None.
    No database access. No side effects.
    """

    # ── CONDITION 1: High-severity unacknowledged risk alert ──────────────────
    for alert in alerts:
        if alert.get("severity") == "high":
            # Tolerate both possible column name conventions
            title = (
                alert.get("alert_title")
                or alert.get("title")
                or alert.get("alert_type")
                or "Risk Alert"
            )
            description = (
                alert.get("alert_description")
                or alert.get("description")
                or alert.get("message")
                or "Please review your portfolio."
            )
            return {
                "digest_type": "risk_alert",
                "headline": f"Risk Alert: {title}",
                "body": (
                    f"{description}. Review your position and consider "
                    f"adjusting your exposure."
                ),
            }

    # ── CONDITION 2: Goal behind target (most recent period) ──────────────────
    for goal in goals:
        goal_id = goal.get("id")
        if not goal_id:
            continue
        # goal_progress rows are already sorted newest-first (ordered by period desc)
        progress_records = goal_progress_by_goal_id.get(goal_id) or []
        # Only evaluate the most recent period
        if not progress_records:
            continue
        latest = progress_records[0]
        if latest.get("on_track") is False:
            goal_name = goal.get("goal_name") or "Your goal"
            target_amt = float(latest.get("target_amount") or 0)
            actual_amt = float(latest.get("actual_amount") or 0)
            actual_pct = round(actual_amt / target_amt * 100, 1) if target_amt > 0 else 0.0
            return {
                "digest_type": "goal_alert",
                "headline": f"Goal Update: {goal_name} is behind target",
                "body": (
                    f"Your {goal_name} goal is currently {actual_pct}% of the "
                    f"100% target for this period. You may want to review "
                    f"your contribution plan."
                ),
            }

    # ── CONDITION 3: Open position in top 10 stocks (composite_score ≥ 75) ───
    for pos in positions:
        ticker = pos.get("ticker")
        if not ticker or ticker not in top_10_tickers:
            continue
        score = ticker_scores.get(ticker, 0.0)
        if score >= 75:
            return {
                "digest_type": "position_signal",
                "headline": f"{ticker} is showing strong signals",
                "body": (
                    f"{ticker} currently scores {score:.0f}/100 in The Eye's ranking. "
                    f"Your position may be worth reviewing in light of current "
                    f"market conditions."
                ),
            }

    # ── CONDITION 4: Financial plan milestone (25 / 50 / 75 %) ───────────────
    if plan:
        target_amount = float(plan.get("target_amount") or 0)
        current_amount = float(plan.get("current_amount") or 0)
        if target_amount > 0:
            current_pct = current_amount / target_amount * 100
            plan_name = plan.get("plan_name") or "Your financial plan"
            target_date = plan.get("target_date") or "your target date"
            # Check milestones highest-first so we announce the most meaningful one
            for milestone in (75, 50, 25):
                if current_pct >= milestone and milestone not in announced_milestones:
                    return {
                        "digest_type": "plan_milestone",
                        "headline": f"Milestone: {plan_name} is {milestone}% complete",
                        "body": (
                            f"Your {plan_name} plan has reached {milestone}% of its "
                            f"target of €{target_amount:,.0f}. "
                            f"You're on track for {target_date}."
                        ),
                    }

    return None


# ── Core sync implementation ──────────────────────────────────────────────────

def _run_intelligence_cycle_sync() -> dict[str, Any]:
    """
    Synchronous implementation. Executed in a thread by run_intelligence_cycle().

    Fetches all data in bulk (no N+1), evaluates four digest conditions per user,
    writes at most one new digest per user (skipping if unread duplicate exists).
    """
    now = datetime.now(timezone.utc)
    cutoff_iso = (now - timedelta(days=30)).isoformat()

    # ── A. Fetch active users ─────────────────────────────────────────────────
    try:
        users = _fetch_active_users(cutoff_iso)
    except Exception as exc:
        logger.error("Intelligence cycle aborted: could not fetch active users: %s", type(exc).__name__)
        return {"users_processed": 0, "digests_generated": 0, "errors": []}

    if not users:
        logger.info("Intelligence cycle: no active users found")
        return {"users_processed": 0, "digests_generated": 0, "errors": []}

    # All meridian tables store the Supabase auth UUID (auth.users.id), not
    # the internal core.users.id.  Use auth_id as the canonical user key here.
    user_ids: list[str] = [u["auth_id"] for u in users if u.get("auth_id")]
    logger.info("Intelligence cycle: processing %d active users", len(user_ids))

    # ── B. Batch fetch all context data ──────────────────────────────────────
    # Each fetch is wrapped individually so a single table error does not abort
    # the whole cycle — users are processed with whatever data is available.

    goals_by_user: dict[str, list] = {uid: [] for uid in user_ids}
    try:
        goals_by_user = _fetch_goals_by_user(user_ids)
    except Exception as exc:
        logger.warning("Intelligence cycle: skipping goals — fetch failed: %s", type(exc).__name__)

    all_goal_ids: list[str] = [
        g["id"]
        for goals in goals_by_user.values()
        for g in goals
        if g.get("id")
    ]
    goal_progress_by_goal_id: dict[str, list] = {}
    try:
        goal_progress_by_goal_id = _fetch_goal_progress(all_goal_ids)
    except Exception as exc:
        logger.warning("Intelligence cycle: skipping goal_progress — fetch failed: %s", type(exc).__name__)

    alerts_by_user: dict[str, list] = {uid: [] for uid in user_ids}
    try:
        alerts_by_user = _fetch_alerts_by_user(user_ids)
    except Exception as exc:
        logger.warning("Intelligence cycle: skipping risk_alerts — fetch failed: %s", type(exc).__name__)

    positions_by_user: dict[str, list] = {uid: [] for uid in user_ids}
    try:
        positions_by_user = _fetch_positions_by_user(user_ids)
    except Exception as exc:
        logger.warning("Intelligence cycle: skipping user_positions — fetch failed: %s", type(exc).__name__)

    plans_by_user: dict[str, dict | None] = {uid: None for uid in user_ids}
    try:
        plans_by_user = _fetch_plans_by_user(user_ids)
    except Exception as exc:
        logger.warning("Intelligence cycle: skipping financial_plans — fetch failed: %s", type(exc).__name__)

    # Duplicate-digest gate: check unread digests for ALL users BEFORE the loop.
    # This is the set that blocks insertion — checked before every insert.
    unread_digest_types: dict[str, set[str]] = {uid: set() for uid in user_ids}
    try:
        unread_digest_types = _fetch_unread_digest_types(user_ids)
    except Exception as exc:
        logger.warning("Intelligence cycle: could not fetch existing digests — duplicate inserts possible: %s", type(exc).__name__)

    # Plan-milestone history: read or unread, to detect already-announced thresholds.
    announced_milestones: dict[str, set[int]] = {uid: set() for uid in user_ids}
    try:
        announced_milestones = _fetch_announced_plan_milestones(user_ids)
    except Exception as exc:
        logger.warning("Intelligence cycle: could not fetch milestone history — may re-announce milestones: %s", type(exc).__name__)

    top_10_tickers: set[str] = set()
    ticker_scores: dict[str, float] = {}
    try:
        top_10_tickers, ticker_scores = _fetch_top_10_stocks()
    except Exception as exc:
        logger.warning("Intelligence cycle: skipping stock signals — fetch failed: %s", type(exc).__name__)

    # ── C + D. Evaluate conditions and write digests ──────────────────────────
    errors: list[dict[str, str]] = []
    digests_generated = 0
    now_iso = now.isoformat()

    for user_id in user_ids:
        try:
            digest = _evaluate_user(
                alerts=alerts_by_user.get(user_id, []),
                goals=goals_by_user.get(user_id, []),
                goal_progress_by_goal_id=goal_progress_by_goal_id,
                positions=positions_by_user.get(user_id, []),
                plan=plans_by_user.get(user_id),
                top_10_tickers=top_10_tickers,
                ticker_scores=ticker_scores,
                announced_milestones=announced_milestones.get(user_id, set()),
            )

            if digest is None:
                continue

            digest_type = digest["digest_type"]

            # Duplicate check: do not insert if an unread digest of this type
            # already exists for this user. This check runs before every insert.
            if digest_type in unread_digest_types.get(user_id, set()):
                continue

            _tbl("meridian", "intelligence_digests").insert({
                "user_id": user_id,
                "digest_type": digest_type,
                "headline": digest["headline"],
                "body": digest["body"],
                "created_at": now_iso,
                "is_read": False,
            }).execute()

            digests_generated += 1

        except Exception as exc:
            # Do NOT log user_id — avoid writing PII to log streams.
            errors.append({
                "user_id": "[redacted]",
                "error": type(exc).__name__,
            })
            logger.warning(
                "Intelligence cycle: digest generation failed for one user (%s)",
                type(exc).__name__,
            )

    logger.info(
        "Intelligence cycle complete: users_processed=%d digests_generated=%d errors=%d",
        len(user_ids),
        digests_generated,
        len(errors),
    )
    return {
        "users_processed": len(user_ids),
        "digests_generated": digests_generated,
        "errors": errors,
    }


# ── Public async entry point ──────────────────────────────────────────────────

async def run_intelligence_cycle() -> dict[str, Any]:
    """
    Run one full intelligence cycle.

    - Executes the sync implementation in a thread (non-blocking).
    - Enforces a run lock: if a previous cycle has not finished, this call
      returns immediately with skipped=True. This prevents a slow cycle
      (e.g. due to Supabase latency) from queuing up indefinitely when the
      scheduler fires the next 6-hour tick.
    - Any unhandled exception is caught, logged, and returned as an error
      summary — the scheduler will never crash due to this function.
    """
    global _cycle_running

    if _cycle_running:
        logger.info("Intelligence cycle skipped: previous cycle still running")
        return {
            "users_processed": 0,
            "digests_generated": 0,
            "errors": [],
            "skipped": True,
        }

    _cycle_running = True
    try:
        return await asyncio.to_thread(_run_intelligence_cycle_sync)
    except Exception as exc:
        logger.error(
            "Intelligence cycle raised unhandled exception: %s",
            type(exc).__name__,
        )
        return {
            "users_processed": 0,
            "digests_generated": 0,
            "errors": [{"user_id": "[redacted]", "error": type(exc).__name__}],
        }
    finally:
        _cycle_running = False
