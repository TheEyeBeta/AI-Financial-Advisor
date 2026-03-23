from __future__ import annotations

from pathlib import Path

from alembic import op


REPO_ROOT = Path(__file__).resolve().parents[2]


def repo_file(*parts: str) -> Path:
    return REPO_ROOT.joinpath(*parts)


def execute_sql_file(*parts: str) -> None:
    path = repo_file(*parts)
    op.execute(path.read_text(encoding="utf-8"))

