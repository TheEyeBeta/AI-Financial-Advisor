"""Fix ai chat grants."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "fix_ai_chat_grants.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading fix_ai_chat_grants.sql is not supported.")
