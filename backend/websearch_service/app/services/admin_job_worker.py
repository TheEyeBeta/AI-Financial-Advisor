"""Worker that claims and executes durable admin jobs."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from .admin_jobs import (
    JOB_TYPE_INTELLIGENCE,
    JOB_TYPE_MEMORY_EXTRACTION,
    JOB_TYPE_MEMORY_SCAN,
    JOB_TYPE_MERIDIAN_REFRESH,
    JOB_TYPE_RANKING,
    claim_next_job,
    complete_job,
    heartbeat_job,
    update_job_progress,
)
from .intelligence_engine import run_intelligence_cycle
from .job_logger import log_job_run
from .memory_agent import run_history_scan, run_memory_extraction_cycle
from .meridian_context import refresh_all_users_context
from .ranking_engine import run_ranking_cycle

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 5.0
HEARTBEAT_INTERVAL_SECONDS = 60.0


async def _run_ranking_job(job_id: str) -> dict[str, Any]:
    from datetime import datetime, timezone

    started_at = datetime.now(timezone.utc)
    summary = await run_ranking_cycle()
    skipped = summary.get("skipped", False)
    await log_job_run(
        job_name=JOB_TYPE_RANKING,
        started_at=started_at,
        status="skipped" if skipped else "success",
        records_processed=summary.get("tickers_scored", 0),
        raw_output=summary,
        run_id=job_id,
    )
    return summary


async def _run_memory_scan_job(job_id: str, parameters: dict[str, Any]) -> dict[str, Any]:
    limit = int(parameters.get("limit") or 200)
    await update_job_progress(job_id, {"phase": "scanning", "limit": limit})
    result = await run_history_scan(limit=limit)
    return {"limit": limit, "result": result}


async def _run_intelligence_job(job_id: str) -> dict[str, Any]:
    from datetime import datetime, timezone

    started_at = datetime.now(timezone.utc)
    summary = await run_intelligence_cycle()
    skipped = summary.get("skipped", False)
    await log_job_run(
        job_name=JOB_TYPE_INTELLIGENCE,
        started_at=started_at,
        status="skipped" if skipped else "success",
        records_processed=summary.get("users_processed", 0),
        raw_output=summary,
        run_id=job_id,
    )
    return summary


async def _run_memory_extraction_job(job_id: str) -> dict[str, Any]:
    from datetime import datetime, timezone

    started_at = datetime.now(timezone.utc)
    summary = await run_memory_extraction_cycle()
    skipped = summary.get("skipped", False)
    await log_job_run(
        job_name=JOB_TYPE_MEMORY_EXTRACTION,
        started_at=started_at,
        status="skipped" if skipped else "success",
        records_processed=summary.get("chats_processed", 0),
        raw_output=summary,
        run_id=job_id,
    )
    return summary


async def _run_meridian_refresh_job(job_id: str) -> dict[str, Any]:
    await update_job_progress(job_id, {"phase": "refreshing"})
    await refresh_all_users_context()
    return {"refreshed": True}


_JOB_HANDLERS: dict[str, Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]] = {
    JOB_TYPE_RANKING: lambda job_id, _params: _run_ranking_job(job_id),
    JOB_TYPE_MEMORY_SCAN: _run_memory_scan_job,
    JOB_TYPE_INTELLIGENCE: lambda job_id, _params: _run_intelligence_job(job_id),
    JOB_TYPE_MEMORY_EXTRACTION: lambda job_id, _params: _run_memory_extraction_job(job_id),
    JOB_TYPE_MERIDIAN_REFRESH: lambda job_id, _params: _run_meridian_refresh_job(job_id),
}


async def execute_admin_job(job: dict[str, Any]) -> None:
    job_id = str(job["id"])
    job_type = str(job["job_type"])
    parameters = job.get("parameters") or {}
    handler = _JOB_HANDLERS.get(job_type)
    if handler is None:
        complete_job(
            job_id,
            status="failed",
            error_code="unknown_job_type",
            error_detail=f"Unsupported job_type={job_type}",
        )
        return

    stop_heartbeat = asyncio.Event()

    async def _heartbeat_loop() -> None:
        while not stop_heartbeat.is_set():
            try:
                await asyncio.wait_for(stop_heartbeat.wait(), timeout=HEARTBEAT_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                heartbeat_job(job_id)

    heartbeat_task = asyncio.create_task(_heartbeat_loop())
    try:
        result = await handler(job_id, parameters)
        complete_job(job_id, status="succeeded", result_summary=result)
    except Exception as exc:
        logger.exception("admin job %s failed: %s", job_id, exc)
        complete_job(
            job_id,
            status="failed",
            error_code=type(exc).__name__,
            error_detail=str(exc)[:2000],
        )
    finally:
        stop_heartbeat.set()
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass


async def process_next_admin_job() -> bool:
    job = await asyncio.to_thread(claim_next_job)
    if not job:
        return False
    await execute_admin_job(job)
    return True


async def run_admin_job_worker_loop(stop_event: asyncio.Event | None = None) -> None:
    """Poll and execute queued admin jobs until stop_event is set."""
    logger.info("Admin job worker loop started")
    while stop_event is None or not stop_event.is_set():
        processed = await process_next_admin_job()
        if not processed:
            try:
                if stop_event is not None:
                    await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SECONDS)
                else:
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                continue
    logger.info("Admin job worker loop stopped")
