"""APScheduler setup for background jobs.

Web API workers must NOT run the scheduler unless ``SCHEDULER_ENABLED=true``.
Deploy a single dedicated scheduler replica (see ``run_scheduler.py``) for beta.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .services.intelligence_engine import run_intelligence_cycle
from .services.job_logger import log_job_run
from .services.memory_agent import run_history_scan, run_memory_extraction_cycle
from .services.ranking_engine import run_ranking_cycle

logger = logging.getLogger(__name__)

_JOB_DEFAULTS = {
    "max_instances": 1,
    "coalesce": True,
    "replace_existing": True,
}


def scheduler_enabled() -> bool:
    """Return True when this process should host APScheduler."""
    return os.getenv("SCHEDULER_ENABLED", "").strip().lower() in ("1", "true", "yes")


async def _run_scheduled_cycle() -> None:
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    try:
        summary = await run_intelligence_cycle()
        skipped = summary.get("skipped", False)
        logger.info(
            "Scheduled intelligence cycle run_id=%s users_processed=%s digests_generated=%s errors=%s%s",
            run_id,
            summary.get("users_processed", 0),
            summary.get("digests_generated", 0),
            len(summary.get("errors", [])),
            " [skipped]" if skipped else "",
        )
        await log_job_run(
            job_name="intelligence_engine",
            started_at=started_at,
            status="skipped" if skipped else "success",
            records_processed=summary.get("users_processed", 0),
            raw_output={**summary, "run_id": run_id},
            run_id=run_id,
        )
    except Exception as exc:
        logger.error("Scheduled intelligence cycle run_id=%s failed: %s", run_id, type(exc).__name__)
        await log_job_run(
            job_name="intelligence_engine",
            started_at=started_at,
            status="error",
            error=type(exc).__name__,
            raw_output={"run_id": run_id},
            run_id=run_id,
        )


async def _run_scheduled_memory_extraction() -> None:
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    try:
        summary = await run_memory_extraction_cycle()
        skipped = summary.get("skipped", False)
        if not skipped:
            logger.info(
                "Scheduled memory extraction run_id=%s chats_processed=%s insights=%s errors=%s",
                run_id,
                summary.get("chats_processed", 0),
                summary.get("total_insights_extracted", 0),
                len(summary.get("errors", [])),
            )
        await log_job_run(
            job_name="memory_extraction",
            started_at=started_at,
            status="skipped" if skipped else "success",
            records_processed=summary.get("chats_processed", 0),
            raw_output={**summary, "run_id": run_id},
            run_id=run_id,
        )
    except Exception as exc:
        logger.error("Scheduled memory extraction run_id=%s failed: %s", run_id, type(exc).__name__)
        await log_job_run(
            job_name="memory_extraction",
            started_at=started_at,
            status="error",
            error=type(exc).__name__,
            raw_output={"run_id": run_id},
            run_id=run_id,
        )


async def _run_scheduled_ranking_cycle() -> None:
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    try:
        summary = await run_ranking_cycle()
        skipped = summary.get("skipped", False)
        if not skipped:
            logger.info(
                "Scheduled ranking cycle run_id=%s tickers_scored=%s top_50_written=%s duration=%.1fs",
                run_id,
                summary.get("tickers_scored", 0),
                summary.get("top_50_written", 0),
                summary.get("cycle_duration_seconds", 0.0),
            )
        await log_job_run(
            job_name="ranking_engine",
            started_at=started_at,
            status="skipped" if skipped else "success",
            records_processed=summary.get("tickers_scored", 0),
            raw_output={**summary, "run_id": run_id},
            run_id=run_id,
        )
    except Exception as exc:
        logger.error("Scheduled ranking cycle run_id=%s failed: %s", run_id, type(exc).__name__)
        await log_job_run(
            job_name="ranking_engine",
            started_at=started_at,
            status="error",
            error=type(exc).__name__,
            raw_output={"run_id": run_id},
            run_id=run_id,
        )


def create_scheduler() -> AsyncIOScheduler:
    """Build a configured AsyncIOScheduler (not started)."""
    scheduler = AsyncIOScheduler(job_defaults=_JOB_DEFAULTS)

    scheduler.add_job(
        _run_scheduled_cycle,
        trigger="interval",
        hours=6,
        id="intelligence_cycle",
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _run_scheduled_ranking_cycle,
        trigger="cron",
        hour=1,
        minute=0,
        timezone="UTC",
        id="ranking_cycle",
        misfire_grace_time=1800,
    )
    scheduler.add_job(
        _run_scheduled_memory_extraction,
        trigger="interval",
        minutes=15,
        id="memory_extraction",
        misfire_grace_time=300,
    )
    return scheduler


async def run_startup_background_tasks() -> None:
    """One-shot startup tasks for the primary web worker (ranking bootstrap, memory scan)."""
    import asyncio as _asyncio
    from datetime import datetime, timezone

    from .services.supabase_client import supabase_client as _supabase_client

    def _get_last_ranked_at():
        result = (
            _supabase_client.schema("market")
            .table("trending_stocks")
            .select("ranked_at")
            .order("ranked_at", desc=True)
            .limit(1)
            .execute()
        )
        if result.data:
            return result.data[0].get("ranked_at")
        return None

    try:
        _last_ranked_at_raw = await _asyncio.to_thread(_get_last_ranked_at)
        _now = datetime.now(timezone.utc)
        if _last_ranked_at_raw is not None:
            if isinstance(_last_ranked_at_raw, str):
                _ranked_at_dt = datetime.fromisoformat(_last_ranked_at_raw.replace("Z", "+00:00"))
            else:
                _ranked_at_dt = _last_ranked_at_raw
        else:
            _ranked_at_dt = None

        if _ranked_at_dt is None or (_now - _ranked_at_dt).total_seconds() >= 90000:
            _asyncio.create_task(_run_scheduled_ranking_cycle())
        else:
            _minutes_ago = int((_now - _ranked_at_dt).total_seconds() / 60)
            logger.info("STARTUP: ranking cycle skipped — ranked %s minutes ago", _minutes_ago)
    except Exception as exc:
        logger.error("STARTUP: ranking check failed: %s", exc, exc_info=True)
        _asyncio.create_task(_run_scheduled_ranking_cycle())

    from .services.memory_agent import _count_user_insights_sync as _count_insights

    try:
        _insight_count = await _asyncio.to_thread(_count_insights)
        if _insight_count < 10:
            _asyncio.create_task(run_history_scan(limit=50))
    except Exception as exc:
        logger.warning("STARTUP: insight bootstrap check failed: %s", exc)


def is_primary_worker() -> bool:
    """Best-effort guard so only one web worker runs startup background tasks."""
    try:
        return os.getpid() == os.getppid() + 1
    except Exception:
        return True
