"""Curriculum seed data."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "curriculum_seed_data.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading curriculum_seed_data.sql is not supported.")
