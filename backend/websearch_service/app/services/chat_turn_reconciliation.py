"""Reconcile stale chat turn requests without deleting user messages."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)

_STALE_STATUSES = ("pending", "processing")
_DEFAULT_STALE_MINUTES = 2


def _stale_threshold_minutes() -> int:
    raw = os.getenv("CHAT_TURN_STALE_MINUTES", str(_DEFAULT_STALE_MINUTES)).strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return _DEFAULT_STALE_MINUTES


async def run_chat_turn_reconciliation() -> dict[str, Any]:
    """Mark stale in-flight turns as failed. Idempotent and non-destructive."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=_stale_threshold_minutes())
    cutoff_iso = cutoff.isoformat()

    try:
        result = (
            supabase_client.schema("ai")
            .table("chat_turn_requests")
            .select("id,status,updated_at")
            .in_("status", list(_STALE_STATUSES))
            .lt("updated_at", cutoff_iso)
            .limit(200)
            .execute()
        )
    except Exception as exc:
        logger.warning("chat_turn_reconciliation query failed: %s", exc)
        return {"skipped": False, "reconciled": 0, "errors": [str(exc)]}

    rows = result.data or []
    reconciled = 0
    errors: list[str] = []

    for row in rows:
        turn_id = row.get("id")
        if not turn_id:
            continue
        try:
            (
                supabase_client.schema("ai")
                .table("chat_turn_requests")
                .update(
                    {
                        "status": "failed",
                        "failure_code": "stale_timeout",
                        "failure_reason": "Assistant response did not complete in time",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        "completed_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                .eq("id", turn_id)
                .in_("status", list(_STALE_STATUSES))
                .execute()
            )
            reconciled += 1
        except Exception as exc:
            errors.append(f"{turn_id}: {exc}")

    return {"skipped": False, "reconciled": reconciled, "errors": errors}
