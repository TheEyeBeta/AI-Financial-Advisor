"""Fix learning_topics RLS."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "fix_learning_topics_rls.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading fix_learning_topics_rls.sql is not supported.")
