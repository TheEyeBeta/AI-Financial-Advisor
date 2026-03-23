#!/usr/bin/env python3
"""Export the FastAPI auto-generated OpenAPI spec to docs/openapi.json.

Usage:
    python backend/websearch_service/export_openapi.py

The script imports the FastAPI application, calls ``app.openapi()`` to obtain
the spec dict, and writes it as pretty-printed JSON to ``docs/openapi.json``
(relative to the repository root).
"""

import json
import sys
from pathlib import Path

# Ensure the websearch_service package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import app  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_PATH = REPO_ROOT / "docs" / "openapi.json"


def main() -> None:
    spec = app.openapi()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    print(f"OpenAPI spec written to {OUTPUT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
