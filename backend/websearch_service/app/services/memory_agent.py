# backend/websearch_service/app/services/memory_agent.py
"""Memory extraction agent — reads completed chat sessions and extracts
structured insights about users, storing them in meridian.user_insights.

Public API:
  extract_insights_from_chat(chat_id, user_id)  → process one session
  run_memory_extraction_cycle()                 → scheduled batch (15 min, ≤20 chats)
  run_history_scan(limit)                       → one-time bootstrap

Privacy note: full message content IS sent to OpenAI for extraction.
This is expected and acceptable. Logs contain only chat_id, truncated
user_id (last 8 chars), and numeric counts — never message content.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
# Override via OPENAI_MEMORY_MODEL env var; defaults to gpt-4o-mini.
_MEMORY_MODEL: str = os.getenv("OPENAI_MEMORY_MODEL", "gpt-4o-mini")
_OPENAI_TIMEOUT = 30.0

_SYSTEM_PROMPT = (
    "You are an insight extraction system. Analyze this financial advisor "
    "conversation and extract structured facts about the user.\n\n"
    "Return ONLY a valid JSON array. Each item must have exactly these fields:\n"
    "{\n"
    '  "insight_type": one of: financial_fact | preference | knowledge_gap | '
    "emotional_marker | life_event | compliance_signal,\n"
    '  "key": snake_case identifier (e.g. loss_aversion, investment_horizon, '
    "mortgage_concern, avoids_healthcare),\n"
    '  "value": specific string value (e.g. high, 5-7 years, March 2026, true),\n'
    '  "confidence": number between 0.0 and 1.0\n'
    "}\n\n"
    "Rules:\n"
    "- Only extract things explicitly stated or strongly implied by the user\n"
    "- Never infer without clear evidence in the text\n"
    "- Never extract things IRIS said — only facts about the USER\n"
    "- Confidence 0.9+ means user stated it explicitly\n"
    "- Confidence 0.7-0.89 means strongly implied\n"
    "- Confidence below 0.7 means skip it entirely — do not include\n"
    "- If nothing extractable exists, return []\n"
    "- Return ONLY the JSON array, no other text, no markdown"
)

# In-process run lock — prevents overlapping extraction cycles.
# For multi-replica deployments, replace with a distributed lock.
_cycle_running: bool = False


# ── Sync DB helpers (always called via asyncio.to_thread) ─────────────────────

def _fetch_messages_sync(chat_id: str) -> list[dict]:
    """Return the last 50 user/assistant messages for a chat, chronological order.

    Fetches newest-first (to apply the LIMIT correctly), then reverses so the
    transcript is oldest-first for the LLM.
    """
    try:
        res = (
            supabase_client.schema("ai")
            .table("chat_messages")
            .select("role, content, created_at")
            .eq("chat_id", chat_id)
            .in_("role", ["user", "assistant"])
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        return list(reversed(res.data or []))
    except Exception:
        logger.exception(
            "memory_agent: DB error fetching messages for chat_id=%s", chat_id
        )
        return []


def _fetch_unprocessed_chats_sync(
    lower_bound: str,
    upper_bound: str,
    limit: int,
) -> list[dict]:
    """Return up to `limit` chats updated between lower_bound and upper_bound
    that have no row in meridian.user_insights with a matching source_chat_id.

    lower_bound = now - 24h  (not ancient history)
    upper_bound = now - 30m  (inactive — no recent activity)
    """
    try:
        # Step 1: collect all chat IDs that have already been processed.
        processed_res = (
            supabase_client.schema("meridian")
            .table("user_insights")
            .select("source_chat_id")
            .not_.is_("source_chat_id", "null")
            .execute()
        )
        processed_ids: list[str] = [
            r["source_chat_id"]
            for r in (processed_res.data or [])
            if r.get("source_chat_id")
        ]

        # Step 2: query chats in the inactive window, excluding processed ones.
        query = (
            supabase_client.schema("ai")
            .table("chats")
            .select("id, user_id")
            .gte("updated_at", lower_bound)
            .lte("updated_at", upper_bound)
            .order("updated_at", desc=True)
            .limit(limit)
        )
        if processed_ids:
            # PostgREST NOT IN filter: ?id=not.in.(id1,id2,...)
            query = query.filter(
                "id", "not.in", "({})".format(",".join(processed_ids))
            )

        res = query.execute()
        return res.data or []
    except Exception:
        logger.exception("memory_agent: DB error fetching unprocessed chats")
        return []


def _fetch_all_unprocessed_chats_sync(limit: int) -> list[dict]:
    """Return up to `limit` unprocessed chats regardless of age (history scan)."""
    try:
        processed_res = (
            supabase_client.schema("meridian")
            .table("user_insights")
            .select("source_chat_id")
            .not_.is_("source_chat_id", "null")
            .execute()
        )
        processed_ids: list[str] = [
            r["source_chat_id"]
            for r in (processed_res.data or [])
            if r.get("source_chat_id")
        ]

        query = (
            supabase_client.schema("ai")
            .table("chats")
            .select("id, user_id")
            .order("updated_at", desc=True)
            .limit(limit)
        )
        if processed_ids:
            query = query.filter(
                "id", "not.in", "({})".format(",".join(processed_ids))
            )

        res = query.execute()
        return res.data or []
    except Exception:
        logger.exception("memory_agent: DB error fetching all unprocessed chats")
        return []


def _upsert_insight_sync(
    user_id: str,
    insight: dict,
    source_chat_id: str,
) -> bool:
    """Conditionally upsert one insight row into meridian.user_insights.

    The Supabase PostgREST client does not support a WHERE clause on conflict
    updates, so the confidence guard is implemented as a read-before-write.
    This is safe here because the extraction cycle processes one chat at a time
    with a 1-second gap, making concurrent writes to the same (user_id, key)
    extremely unlikely.

    Returns True if the row was written, False if skipped (existing row has
    equal-or-higher confidence).

    user_id is auth.users.id — the Supabase auth UUID — which matches the
    foreign key on meridian.user_insights.
    """
    key = insight.get("key", "")
    new_confidence = float(insight.get("confidence", 0))
    uid_tail = user_id[-8:] if user_id else "unknown"

    try:
        # Check whether a higher-confidence insight already exists for this key.
        existing_res = (
            supabase_client.schema("meridian")
            .table("user_insights")
            .select("confidence")
            .eq("user_id", user_id)
            .eq("key", key)
            .maybe_single()
            .execute()
        )
        if existing_res.data:
            existing_confidence = float(existing_res.data.get("confidence") or 0)
            if existing_confidence > new_confidence:
                # Preserve the higher-confidence insight — never downgrade.
                return False

        supabase_client.schema("meridian").table("user_insights").upsert(
            {
                "user_id": user_id,
                "insight_type": insight.get("insight_type", ""),
                "key": key,
                "value": str(insight.get("value", "")),
                "confidence": new_confidence,
                "source_chat_id": source_chat_id,
                "is_active": True,
            },
            on_conflict="user_id,key",
        ).execute()
        return True

    except Exception:
        logger.exception(
            "memory_agent: DB error upserting insight key=%s user=...%s",
            key,
            uid_tail,
        )
        return False


def _count_user_insights_sync() -> int:
    """Return the number of rows in meridian.user_insights (capped at 11).

    Used only for the startup bootstrap threshold check.  Fetching 11 rows
    is sufficient to determine whether fewer than 10 rows exist without
    scanning the whole table.
    """
    try:
        res = (
            supabase_client.schema("meridian")
            .table("user_insights")
            .select("id")
            .limit(11)
            .execute()
        )
        return len(res.data or [])
    except Exception:
        logger.warning("memory_agent: could not count user_insights rows")
        return 0


# ── Transcript helpers ─────────────────────────────────────────────────────────

def _format_transcript(messages: list[dict]) -> str:
    """Format a list of chat messages as a [User] / [IRIS] transcript string."""
    lines: list[str] = []
    for msg in messages:
        role = msg.get("role", "")
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        label = "[User]" if role == "user" else "[IRIS]"
        lines.append(f"{label}: {content}")
    return "\n".join(lines)


# ── OpenAI extraction call ─────────────────────────────────────────────────────

async def _call_openai_for_insights(transcript: str) -> list[dict]:
    """Call GPT-4o-mini to extract structured insights from a transcript.

    Returns a filtered list of insight dicts (confidence >= 0.7), or [] on
    any error.  Message content IS sent to OpenAI — expected and acceptable.
    """
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        logger.warning("memory_agent: OPENAI_API_KEY not set — skipping extraction")
        return []

    payload = {
        "model": _MEMORY_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": transcript},
        ],
        "max_tokens": 500,
        "temperature": 0,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=_OPENAI_TIMEOUT) as client:
            response = await client.post(_OPENAI_ENDPOINT, headers=headers, json=payload)

        if response.status_code != 200:
            logger.warning(
                "memory_agent: OpenAI returned HTTP %d during extraction",
                response.status_code,
            )
            return []

        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            return []

        raw = choices[0].get("message", {}).get("content", "").strip()

        # Strip markdown code fences if the model wrapped its output.
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw).rstrip("`").strip()

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.error(
                "memory_agent: JSON parse failed for OpenAI response (%s) — returning 0 insights",
                exc,
            )
            return []

        if not isinstance(parsed, list):
            logger.error(
                "memory_agent: OpenAI response was not a JSON array — returning 0 insights"
            )
            return []

        # Filter out anything below the confidence threshold (spec: skip < 0.7).
        return [
            item
            for item in parsed
            if isinstance(item, dict) and float(item.get("confidence", 0)) >= 0.7
        ]

    except httpx.TimeoutException:
        logger.warning("memory_agent: OpenAI request timed out")
        return []
    except Exception as exc:
        logger.error(
            "memory_agent: OpenAI call failed with %s — returning 0 insights",
            type(exc).__name__,
        )
        return []


# ── Public async API ───────────────────────────────────────────────────────────

async def extract_insights_from_chat(chat_id: str, user_id: str) -> dict[str, Any]:
    """Extract structured insights from a single completed chat session.

    Steps:
      A. Fetch the last 50 user/assistant messages (system messages excluded).
      B. Build a [User]/[IRIS] transcript and call GPT-4o-mini.
      C. Parse + filter the JSON response (drop confidence < 0.7).
      D. Upsert to meridian.user_insights (never overwrite higher confidence).
      E. Return a summary dict.

    Never raises — always returns a dict.
    """
    uid_tail = user_id[-8:] if user_id else "unknown"

    # A. Fetch transcript
    messages = await asyncio.to_thread(_fetch_messages_sync, chat_id)

    user_messages = [m for m in messages if m.get("role") == "user"]
    if len(user_messages) < 3:
        logger.debug(
            "memory_agent: chat_id=%s user=...%s — only %d user message(s), skipping",
            chat_id,
            uid_tail,
            len(user_messages),
        )
        return {
            "chat_id": chat_id,
            "insights_extracted": 0,
            "reason": "insufficient_messages",
        }

    # B. Build prompt and call OpenAI (message content sent — expected, acceptable)
    transcript = _format_transcript(messages)
    insights = await _call_openai_for_insights(transcript)

    insights_extracted = len(insights)

    if not insights:
        return {
            "chat_id": chat_id,
            "insights_extracted": 0,
            "insights_written": 0,
            "failed": 0,
        }

    # D. Write each insight to meridian.user_insights
    insights_written = 0
    failed = 0
    for insight in insights:
        try:
            written = await asyncio.to_thread(
                _upsert_insight_sync, user_id, insight, chat_id
            )
            if written:
                insights_written += 1
        except Exception:
            failed += 1
            logger.error(
                "memory_agent: unexpected error writing insight for chat_id=%s user=...%s",
                chat_id,
                uid_tail,
            )

    logger.info(
        "memory_agent: chat_id=%s user=...%s extracted=%d written=%d failed=%d",
        chat_id,
        uid_tail,
        insights_extracted,
        insights_written,
        failed,
    )

    # E. Return summary
    return {
        "chat_id": chat_id,
        "insights_extracted": insights_extracted,
        "insights_written": insights_written,
        "failed": failed,
    }


async def run_memory_extraction_cycle() -> dict[str, Any]:
    """Scheduled batch extraction — processes up to 20 inactive chat sessions.

    Targets sessions updated between 30 minutes ago and 24 hours ago that
    have not yet been processed (no matching source_chat_id in user_insights).

    Runs every 15 minutes via APScheduler. A run lock prevents overlapping
    executions in single-process deployments. Never raises.
    """
    global _cycle_running

    if _cycle_running:
        logger.info("memory_agent: extraction cycle skipped — previous cycle still running")
        return {
            "chats_processed": 0,
            "total_insights_extracted": 0,
            "errors": [],
            "skipped": True,
        }

    _cycle_running = True
    try:
        now = datetime.now(timezone.utc)
        lower_bound = (now - timedelta(hours=24)).isoformat()
        upper_bound = (now - timedelta(minutes=30)).isoformat()

        # A. Find inactive, unprocessed chats (30 min – 24 h window, limit 20)
        chats = await asyncio.to_thread(
            _fetch_unprocessed_chats_sync, lower_bound, upper_bound, 20
        )

        if not chats:
            logger.info("memory_agent: extraction cycle — no unprocessed chats found")
            return {"chats_processed": 0, "total_insights_extracted": 0, "errors": []}

        logger.info(
            "memory_agent: extraction cycle — processing %d chat(s)", len(chats)
        )

        chats_processed = 0
        total_insights = 0
        errors: list[str] = []

        # B. Process each chat; one failure must not stop the cycle
        for chat in chats:
            chat_id = chat.get("id", "")
            user_id = chat.get("user_id", "")

            if not chat_id or not user_id:
                continue

            try:
                result = await extract_insights_from_chat(chat_id, user_id)
                chats_processed += 1
                total_insights += result.get("insights_extracted", 0)
            except Exception:
                errors.append(chat_id)
                logger.error(
                    "memory_agent: extraction cycle — failed for chat_id=%s", chat_id
                )

            # 1-second sleep between calls to respect OpenAI rate limits
            await asyncio.sleep(1)

        logger.info(
            "memory_agent: extraction cycle complete — chats=%d insights=%d errors=%d",
            chats_processed,
            total_insights,
            len(errors),
        )

        # C. Return summary
        return {
            "chats_processed": chats_processed,
            "total_insights_extracted": total_insights,
            "errors": errors,
        }

    except Exception as exc:
        logger.error(
            "memory_agent: extraction cycle raised unhandled exception: %s",
            type(exc).__name__,
        )
        return {"chats_processed": 0, "total_insights_extracted": 0, "errors": []}
    finally:
        _cycle_running = False


async def run_history_scan(limit: int = 100) -> dict[str, Any]:
    """One-time bootstrap — processes existing chat history regardless of age.

    Intended to be called once manually (or on first deploy when
    meridian.user_insights is nearly empty). Not scheduled.
    Logs progress every 10 chats. Never raises.
    """
    logger.info("memory_agent: history scan starting (limit=%d)", limit)

    chats = await asyncio.to_thread(_fetch_all_unprocessed_chats_sync, limit)

    if not chats:
        logger.info("memory_agent: history scan — no unprocessed chats found")
        return {"chats_processed": 0, "total_insights_extracted": 0, "errors": []}

    total = len(chats)
    logger.info("memory_agent: history scan — found %d unprocessed chat(s)", total)

    chats_processed = 0
    total_insights = 0
    errors: list[str] = []

    for i, chat in enumerate(chats, start=1):
        chat_id = chat.get("id", "")
        user_id = chat.get("user_id", "")

        if not chat_id or not user_id:
            continue

        try:
            result = await extract_insights_from_chat(chat_id, user_id)
            chats_processed += 1
            total_insights += result.get("insights_extracted", 0)
        except Exception:
            errors.append(chat_id)
            logger.error(
                "memory_agent: history scan — failed for chat_id=%s", chat_id
            )

        if i % 10 == 0:
            logger.info(
                "memory_agent: history scan progress — processed %d/%d chats", i, total
            )

        # 1-second sleep between calls to respect OpenAI rate limits
        await asyncio.sleep(1)

    logger.info(
        "memory_agent: history scan complete — chats=%d insights=%d errors=%d",
        chats_processed,
        total_insights,
        len(errors),
    )

    return {
        "chats_processed": chats_processed,
        "total_insights_extracted": total_insights,
        "errors": errors,
    }
