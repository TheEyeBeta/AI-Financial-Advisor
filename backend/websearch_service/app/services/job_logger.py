"""Job run logger — records scheduler execution results to core.job_run_logs.

Generates a plain-English admin summary via Claude Haiku after each run.
Falls back gracefully when the DB or Anthropic API is unavailable so job
execution is never interrupted by logging failures.

Usage::

    from .job_logger import log_job_run

    started = datetime.now(timezone.utc)
    result = await run_some_cycle()
    await log_job_run(
        job_name="intelligence_engine",
        started_at=started,
        status="success",          # "success" | "error" | "skipped"
        records_processed=result.get("users_processed", 0),
        raw_output=result,
        error=None,
    )
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from .supabase_client import supabase_client

logger = logging.getLogger(__name__)

_ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages"
_HAIKU_MODEL = "claude-haiku-4-5-20251001"
_SUMMARY_TIMEOUT = 15.0  # seconds

_SUMMARY_PROMPT = (
    "Summarise this job run in 2-3 sentences for an admin dashboard. "
    "Be specific about what was processed and any issues found.\n"
    "Job: {job_name}\n"
    "Status: {status}\n"
    "Records processed: {records_processed}\n"
    "Raw output: {raw_output}"
)


async def _generate_summary(
    job_name: str,
    status: str,
    records_processed: int | None,
    raw_output: dict[str, Any],
) -> str | None:
    """Call Claude Haiku to produce a 2-3 sentence admin-friendly summary."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        logger.debug("job_logger: ANTHROPIC_API_KEY not set — skipping AI summary")
        return None

    prompt = _SUMMARY_PROMPT.format(
        job_name=job_name,
        status=status,
        records_processed=records_processed if records_processed is not None else "N/A",
        raw_output=json.dumps(raw_output, default=str)[:1500],
    )

    try:
        async with httpx.AsyncClient(timeout=_SUMMARY_TIMEOUT) as client:
            resp = await client.post(
                _ANTHROPIC_ENDPOINT,
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": _HAIKU_MODEL,
                    "max_tokens": 256,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["content"][0]["text"].strip()
    except Exception as exc:
        logger.warning("job_logger: AI summary generation failed: %s", exc)
        return None


def _write_log_sync(row: dict[str, Any]) -> None:
    """Synchronous Supabase insert — called from asyncio.to_thread."""
    supabase_client.schema("core").table("job_run_logs").insert(row).execute()


async def log_job_run(
    *,
    job_name: str,
    started_at: datetime,
    status: str,
    records_processed: int | None = None,
    raw_output: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Write a job run record to core.job_run_logs. Never raises."""
    finished_at = datetime.now(timezone.utc)
    output = raw_output or {}

    summary = await _generate_summary(
        job_name=job_name,
        status=status,
        records_processed=records_processed,
        raw_output=output,
    )

    row: dict[str, Any] = {
        "job_name": job_name,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "status": status,
        "records_processed": records_processed,
        "summary": summary,
        "error": error,
    }

    try:
        await asyncio.to_thread(_write_log_sync, row)
        logger.info(
            "job_logger: logged run job=%s status=%s records=%s",
            job_name,
            status,
            records_processed,
        )
    except Exception as exc:
        logger.warning("job_logger: failed to write job run log: %s", exc)
