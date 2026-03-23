"""Create ai chat tables."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "create_ai_chat_tables.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading create_ai_chat_tables.sql is not supported.")
