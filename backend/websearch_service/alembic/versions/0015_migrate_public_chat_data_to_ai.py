"""Migrate public chat data to ai schema."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "migrate_public_chat_data_to_ai.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading migrate_public_chat_data_to_ai.sql is not supported.")
