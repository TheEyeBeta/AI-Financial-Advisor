"""Fix RLS policies for multi-schema layout."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "fix_rls_policies_schema.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading fix_rls_policies_schema.sql is not supported.")
