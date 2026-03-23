"""Add market.news table."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "add_news_table.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading add_news_table.sql is not supported.")
