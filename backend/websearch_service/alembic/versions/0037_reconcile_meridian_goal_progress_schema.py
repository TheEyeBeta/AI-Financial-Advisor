"""Reconcile meridian.goal_progress schema — real, confirmed mismatch.

Root cause (confirmed by replaying this history against a clean Postgres 16
database): migration 0001 executes
alembic/sql/0001_runtime_extensions.sql, which creates
meridian.goal_progress with columns `snapshot_date` / `plan_amount` /
`variance_pct` (no `created_at`). Migration 0025 later runs
`CREATE TABLE IF NOT EXISTS meridian.goal_progress (... period ...
target_amount ... created_at ...)` — but because the table already exists
from 0001, that statement is a no-op. Every database that has run this
migration history therefore still has the 0001 (legacy) column names, while
intelligence_engine.py queries `period`, `target_amount`, `actual_amount`,
`on_track` (see `_fetch_goal_progress`). Previously this failed on every
intelligence cycle and was silently swallowed by a broad `except Exception`
in `_run_intelligence_cycle_sync` (fixed alongside this migration — see
GoalProgressSchemaError in app/services/intelligence_engine.py).

This migration is forward-only and idempotent (safe to run more than once):
legacy columns are renamed in place (not dropped/recreated) so existing rows
are preserved, `created_at` is added with a NOW() default (it never existed
before), and `period` is backfilled from `created_at` only in the
(unreached in practice, since the rename always populates it) case where a
row has neither a legacy `snapshot_date` value nor a `period` value.
"""

from __future__ import annotations

from alembic import op

revision = "0037_goal_progress_reconcile"
down_revision = "0036_core_audit_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Rename legacy columns in place if present (preserves data) ────────
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'meridian' AND table_name = 'goal_progress'
                  AND column_name = 'snapshot_date'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'meridian' AND table_name = 'goal_progress'
                  AND column_name = 'period'
            ) THEN
                ALTER TABLE meridian.goal_progress RENAME COLUMN snapshot_date TO period;
            END IF;

            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'meridian' AND table_name = 'goal_progress'
                  AND column_name = 'plan_amount'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'meridian' AND table_name = 'goal_progress'
                  AND column_name = 'target_amount'
            ) THEN
                ALTER TABLE meridian.goal_progress RENAME COLUMN plan_amount TO target_amount;
            END IF;
        END $$;
    """)

    # ── 2. Ensure the columns intelligence_engine.py queries exist. Also add
    #        created_at (never present in the 0001 legacy shape) with a NOW()
    #        default so both new and pre-existing rows get a real value. ────
    op.execute("""
        ALTER TABLE meridian.goal_progress
            ADD COLUMN IF NOT EXISTS period         DATE,
            ADD COLUMN IF NOT EXISTS target_amount   NUMERIC,
            ADD COLUMN IF NOT EXISTS actual_amount   NUMERIC,
            ADD COLUMN IF NOT EXISTS on_track        BOOLEAN,
            ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
    """)

    # ── 3. Deterministic backfill: any legacy row with a NULL period (no
    #        snapshot_date to rename from) takes its created_at date. ───────
    op.execute("""
        UPDATE meridian.goal_progress
        SET period = created_at::date
        WHERE period IS NULL AND created_at IS NOT NULL;
    """)

    # ── 4. Enforce NOT NULL on period only if no NULLs remain (safe) ────────
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM meridian.goal_progress WHERE period IS NULL) THEN
                ALTER TABLE meridian.goal_progress ALTER COLUMN period SET NOT NULL;
            END IF;
        END $$;
    """)

    # ── 5. Ensure the uniqueness constraint the query pattern relies on ─────
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'meridian.goal_progress'::regclass
                  AND contype = 'u'
                  AND conname = 'goal_progress_goal_id_period_key'
            ) THEN
                ALTER TABLE meridian.goal_progress
                    ADD CONSTRAINT goal_progress_goal_id_period_key UNIQUE (goal_id, period);
            END IF;
        END $$;
    """)

    # ── 6. Non-negative amount guards (intelligence_engine.py divides
    #        actual_amount / target_amount to compute a percentage). ────────
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'goal_progress_target_amount_nonneg'
            ) THEN
                ALTER TABLE meridian.goal_progress
                    ADD CONSTRAINT goal_progress_target_amount_nonneg
                    CHECK (target_amount IS NULL OR target_amount >= 0);
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'goal_progress_actual_amount_nonneg'
            ) THEN
                ALTER TABLE meridian.goal_progress
                    ADD CONSTRAINT goal_progress_actual_amount_nonneg
                    CHECK (actual_amount IS NULL OR actual_amount >= 0);
            END IF;
        END $$;
    """)

    # ── 7. Index matching the actual query pattern: filter by goal_id (IN),
    #        order by period DESC (_fetch_goal_progress in intelligence_engine.py). ─
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_goal_progress_goal_id_period_desc
            ON meridian.goal_progress (goal_id, period DESC);
    """)


def downgrade() -> None:
    # Forward-only reconciliation: every step above is either already assumed
    # by 0025 (on a DB that only ever went through Alembic, this migration
    # changes nothing) or a rename/backfill of a legacy column that would
    # otherwise be silently dropped. There is no safe, data-preserving way to
    # revert a rename without knowing whether the pre-migration name was
    # actually in use, so downgrade is intentionally a no-op rather than a
    # DROP COLUMN that could discard live data.
    pass
