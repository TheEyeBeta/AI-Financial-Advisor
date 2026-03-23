"""Add rate limit state."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "add_rate_limit_state.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading add_rate_limit_state.sql is not supported.")
