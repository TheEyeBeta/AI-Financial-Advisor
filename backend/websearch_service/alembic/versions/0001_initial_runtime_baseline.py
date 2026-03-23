"""Initial runtime baseline."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("backend", "websearch_service", "alembic", "sql", "0001_supabase_compat.sql")
    execute_sql_file("sql", "schema.sql")
    execute_sql_file("backend", "websearch_service", "alembic", "sql", "0001_runtime_extensions.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading the initial runtime baseline is not supported.")
