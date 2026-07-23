from __future__ import annotations

from pathlib import Path

from alembic import op


def repo_root() -> Path:
    """Monorepo root, two levels above this file (backend/websearch_service/..).

    Resolved lazily — not at import time — because Alembic's ScriptDirectory
    imports every version module to build its revision graph (e.g. to resolve
    ``get_current_head()``), including in the deployed backend image, which
    only ships ``backend/websearch_service`` and has no monorepo root two
    levels up. Deferring this means read-only head resolution keeps working
    there; only an actual ``execute_sql_file()`` call (real migration run,
    which only happens from a full checkout) requires it to exist.
    """
    return Path(__file__).resolve().parents[2]


def repo_file(*parts: str) -> Path:
    return repo_root().joinpath(*parts)


def execute_sql_file(*parts: str) -> None:
    path = repo_file(*parts)
    op.execute(path.read_text(encoding="utf-8"))

