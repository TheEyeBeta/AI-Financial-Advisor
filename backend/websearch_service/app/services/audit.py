from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


AUDIT_LOG_PATH_ENV = "AI_AUDIT_LOG_PATH"
DEFAULT_AUDIT_LOG_PATH = "logs/audit.jsonl"


async def audit_log(event: str, data: dict[str, Any]) -> None:
    """Append security-relevant AI proxy events to a JSONL audit log."""
    log_path = Path(os.getenv(AUDIT_LOG_PATH_ENV, DEFAULT_AUDIT_LOG_PATH))
    log_path.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "data": data,
    }

    with log_path.open("a", encoding="utf-8") as file_obj:
        file_obj.write(json.dumps(entry) + "\n")
