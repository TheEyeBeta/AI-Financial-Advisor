"""Fix stock snapshots RLS."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "fix_stock_snapshots_rls.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading fix_stock_snapshots_rls.sql is not supported.")
