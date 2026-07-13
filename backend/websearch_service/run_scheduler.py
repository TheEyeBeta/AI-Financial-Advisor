#!/usr/bin/env python3
"""Dedicated scheduler process — run with SCHEDULER_ENABLED=true (single replica).

Example:
    cd backend/websearch_service
    SCHEDULER_ENABLED=true python run_scheduler.py
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from pathlib import Path

from dotenv import load_dotenv

_env_paths = [
    Path(__file__).parent / ".env",
    Path(__file__).parent.parent.parent / ".env",
]
for _env_path in _env_paths:
    if _env_path.exists():
        load_dotenv(_env_path)
        break

os.environ.setdefault("SCHEDULER_ENABLED", "true")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from app.scheduler_config import create_scheduler, scheduler_enabled  # noqa: E402
from app.services.admin_job_worker import run_admin_job_worker_loop  # noqa: E402


async def _main() -> None:
    if not scheduler_enabled():
        raise SystemExit("SCHEDULER_ENABLED must be true for run_scheduler.py")

    scheduler = create_scheduler()
    scheduler.start()
    logging.getLogger(__name__).info(
        "Dedicated scheduler started (intelligence=6h, ranking=01:00 UTC, memory=15m)"
    )

    stop = asyncio.Event()
    worker_task = asyncio.create_task(run_admin_job_worker_loop(stop))

    def _handle_signal(*_args: object) -> None:
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            signal.signal(sig, lambda *_: stop.set())

    await stop.wait()
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    scheduler.shutdown(wait=True)
    logging.getLogger(__name__).info("Dedicated scheduler shut down cleanly")


if __name__ == "__main__":
    asyncio.run(_main())
