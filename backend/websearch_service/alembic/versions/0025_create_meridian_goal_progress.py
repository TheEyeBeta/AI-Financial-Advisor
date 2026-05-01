"""Create meridian.goal_progress table.

The intelligence engine queries meridian.goal_progress to evaluate whether a
user's goals are on track each cycle. The table never existed in the meridian
schema (the public schema has an older variant with different column names), so
every intelligence cycle raised an APIError and skipped goal-progress digests.

Columns match what intelligence_engine.py selects:
  goal_id, period, actual_amount, target_amount, on_track
"""

from __future__ import annotations

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS meridian.goal_progress (
            id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            goal_id        UUID        NOT NULL,
            period         DATE        NOT NULL,
            actual_amount  NUMERIC,
            target_amount  NUMERIC,
            on_track       BOOLEAN,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (goal_id, period)
        );
    """)

    op.execute("ALTER TABLE meridian.goal_progress ENABLE ROW LEVEL SECURITY;")

    op.execute("""
        DROP POLICY IF EXISTS "Service role manages goal_progress" ON meridian.goal_progress;
        CREATE POLICY "Service role manages goal_progress"
        ON meridian.goal_progress FOR ALL
        TO service_role
        USING (TRUE)
        WITH CHECK (TRUE);
    """)

    op.execute("""
        GRANT SELECT, INSERT, UPDATE, DELETE ON meridian.goal_progress TO service_role;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS meridian.goal_progress;")
