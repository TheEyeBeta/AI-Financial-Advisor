"""Expose ai schema to PostgREST."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "expose_ai_schema_to_postgrest.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading expose_ai_schema_to_postgrest.sql is not supported.")
