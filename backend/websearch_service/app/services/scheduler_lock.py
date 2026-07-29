"""Cross-replica lease locks for scheduled batch cycles.

Backs onto `core.scheduler_locks` / `try_acquire_scheduler_lock` /
`release_scheduler_lock` (migration 0044). See that migration's docstring
for why a table-backed lease was chosen over a Postgres advisory lock.

Used by ranking_engine, memory_agent, and intelligence_engine to prevent
two replicas from running the same scheduled cycle concurrently — each of
those already guards against same-process re-entrancy with an in-process
flag; this adds the cluster-wide guarantee that flag can't provide.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from .admin_jobs import worker_id
from .supabase_client import supabase_client

logger = logging.getLogger(__name__)

DEFAULT_LEASE_SECONDS = 900


def _call_rpc(fn_name: str, params: dict[str, Any]):
    return supabase_client.schema("core").rpc(fn_name, params).execute()


async def try_acquire(lock_name: str, *, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> bool:
    """Attempt to acquire the cluster-wide lease for `lock_name`.

    Never raises: a failure to reach the lock backend is treated the same
    as "another replica holds it" (returns False) so a transient DB issue
    degrades to "skip this cycle, try again next tick" rather than crashing
    the scheduler — matching the existing in-process skip behavior.
    """
    try:
        result = await asyncio.to_thread(
            _call_rpc,
            "try_acquire_scheduler_lock",
            {
                "p_lock_name": lock_name,
                "p_worker_id": worker_id(),
                "p_lease_seconds": lease_seconds,
            },
        )
        return bool(result.data)
    except Exception:
        logger.warning(
            "scheduler_lock: failed to acquire lock %r — treating as not acquired",
            lock_name,
            exc_info=True,
        )
        return False


async def release(lock_name: str) -> None:
    try:
        await asyncio.to_thread(
            _call_rpc,
            "release_scheduler_lock",
            {"p_lock_name": lock_name, "p_worker_id": worker_id()},
        )
    except Exception:
        logger.warning(
            "scheduler_lock: failed to release lock %r (will expire via lease)",
            lock_name,
            exc_info=True,
        )
