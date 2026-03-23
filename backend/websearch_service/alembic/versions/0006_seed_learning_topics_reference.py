"""Reference marker for seed_learning_topics.sql."""

from __future__ import annotations


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Reference-only sample data file. It contains the literal placeholder
    # `YOUR_USER_ID`, so replaying it in Alembic would fail on real databases.
    pass


def downgrade() -> None:
    pass
