"""Reference marker for verify_ai_chat_readiness.sql."""

from __future__ import annotations


revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Verification-only query bundle. Keep it as a reference script instead of
    # replaying a non-mutating health check inside the migration history.
    pass


def downgrade() -> None:
    pass
