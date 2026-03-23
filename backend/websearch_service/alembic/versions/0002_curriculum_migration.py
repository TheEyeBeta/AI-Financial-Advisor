"""Curriculum migration."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "curriculum_migration.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading curriculum_migration.sql is not supported.")
