"""Fix user_id migration."""

from __future__ import annotations

from migration_helpers import execute_sql_file


revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    execute_sql_file("sql", "fix_user_id_migration.sql")


def downgrade() -> None:
    raise NotImplementedError("Downgrading fix_user_id_migration.sql is not supported.")
