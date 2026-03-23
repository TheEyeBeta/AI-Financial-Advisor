"""Reference marker for CURRICULUM_SQL_BUNDLE.sql."""

from __future__ import annotations


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Reference-only bundle. The executable content is already represented by
    # 0002_curriculum_migration and 0003_curriculum_seed_data.
    pass


def downgrade() -> None:
    pass
