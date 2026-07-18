"""Scheduled reconciliation against the OpenAI Costs API.

This is **observability only**. Requirement: "OpenAI provider budgets are
soft alerts, so the application hard stop must not depend on provider-side
budget enforcement" — this module never writes to the budget guard's
spend counters and a failure here must never disable or weaken the local
hard stop. It exists purely to detect drift between our internal cost
model (``ai_pricing.py``) and OpenAI's actual billed costs, and to persist
that comparison for admins via the audit trail.

Requires an OpenAI **admin/organization** API key with Costs API access
(``OPENAI_ADMIN_API_KEY``); this is intentionally separate from the
request-serving ``OPENAI_API_KEY`` since the Costs API needs org-level
permissions the chat-serving key should not carry. When unset, or when the
call fails for any reason, this function logs and returns a
``skipped``/``error`` status without raising — callers (a cron endpoint)
must treat that as non-fatal.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .ai_budget_guard import ai_budget_guard
from .audit import audit_log

logger = logging.getLogger(__name__)

OPENAI_COSTS_ENDPOINT = "https://api.openai.com/v1/organization/costs"
OPENAI_ADMIN_API_KEY_ENV = "OPENAI_ADMIN_API_KEY"


async def reconcile_openai_costs(*, lookback_hours: int = 26) -> dict[str, Any]:
    """Fetch OpenAI's billed cost for the recent window and compare it to
    our internally tracked spend. Returns a status dict; never raises.
    """
    admin_key = (os.getenv(OPENAI_ADMIN_API_KEY_ENV) or "").strip()
    if not admin_key:
        return {"status": "skipped", "reason": "OPENAI_ADMIN_API_KEY not configured"}

    start_time = int(time.time()) - (lookback_hours * 3600)

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                OPENAI_COSTS_ENDPOINT,
                headers={"Authorization": f"Bearer {admin_key}"},
                params={"start_time": start_time, "limit": 180},
            )
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:
        logger.warning("OpenAI Costs API reconciliation failed (non-fatal, local hard stop unaffected): %s", exc)
        await audit_log(
            "ai_cost_reconciliation_failed",
            {"reason": str(exc)[:200], "lookback_hours": lookback_hours},
            actor_type="system",
            result="error",
        )
        return {"status": "error", "detail": str(exc)[:200]}

    provider_total_usd = 0.0
    for bucket in payload.get("data", []):
        for result in bucket.get("results", []):
            amount = result.get("amount", {})
            provider_total_usd += float(amount.get("value", 0) or 0)

    internal_status = ai_budget_guard.get_status()
    internal_day_spend = float(internal_status.get("day_spend_usd", 0) or 0)

    drift_usd = provider_total_usd - internal_day_spend
    drift_pct = (drift_usd / provider_total_usd) if provider_total_usd else 0.0

    result = {
        "status": "ok",
        "window_start": datetime.fromtimestamp(start_time, tz=timezone.utc).isoformat(),
        "provider_reported_usd": round(provider_total_usd, 4),
        "internal_tracked_usd": round(internal_day_spend, 4),
        "drift_usd": round(drift_usd, 4),
        "drift_pct": round(drift_pct, 4),
    }

    await audit_log(
        "ai_cost_reconciliation_completed",
        result,
        actor_type="system",
        result="success",
    )

    if abs(drift_pct) > 0.25 and provider_total_usd > 1.0:
        logger.warning(
            "AI cost reconciliation drift exceeds 25%%: provider=$%.2f internal=$%.2f drift=%.1f%%",
            provider_total_usd,
            internal_day_spend,
            drift_pct * 100,
        )

    return result
