"""Ensure ai chat schema access."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "ensure_ai_chat_schema_access.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading ensure_ai_chat_schema_access.sql is not supported.")
