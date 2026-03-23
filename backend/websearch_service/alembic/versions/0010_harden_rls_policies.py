"""Harden RLS policies."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "harden_rls_policies.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading harden_rls_policies.sql is not supported.")
