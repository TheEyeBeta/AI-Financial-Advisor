from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


AUDIT_LOG_PATH_ENV = "AI_AUDIT_LOG_PATH"
DEFAULT_AUDIT_LOG_PATH = "logs/audit.jsonl"


def _append_audit_entry(log_path: Path, entry: dict[str, Any]) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as file_obj:
        file_obj.write(json.dumps(entry) + "\n")


async def audit_log(event: str, data: dict[str, Any]) -> None:
    """Append security-relevant AI proxy events to a JSONL audit log."""
    log_path = Path(os.getenv(AUDIT_LOG_PATH_ENV, DEFAULT_AUDIT_LOG_PATH))

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "data": data,
    }

    # Offload file writes to a thread so FastAPI's event loop stays responsive.
    await asyncio.to_thread(_append_audit_entry, log_path, entry)
