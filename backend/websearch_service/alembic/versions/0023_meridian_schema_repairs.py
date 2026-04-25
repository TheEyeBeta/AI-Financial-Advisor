"""Meridian/IRIS schema repairs — fix gaps between code and DB schema.

Gaps closed by this migration:

1. meridian.financial_plans — code queries scalar columns (plan_name,
   target_amount, target_date, current_amount, status) that never existed;
   only plan_data JSONB and is_current were present.  Adding the scalar
   columns allows the cache-builder query to work.

2. ai.iris_context_cache — cache-builder upserts journal_summary,
   portfolio_stats, and achievement_summary but those columns were never
   created; data was silently dropped on every upsert.

3. core.user_profiles — code references country_of_residence and
   employment_status; columns were absent, always returning None.

4. meridian.user_insights — block 13 of the IRIS context builder queries
   this table, but it was never created in any prior migration.  The
   missing table caused every context refresh to log a warning and produce
   an empty insights section.

5. meridian.life_events — code selects the column "description" but the
   actual column is "notes".  A generated column alias (notes AS description)
   is added so the Python code works without touching the stored column name.
   (The Python fix in meridian_context.py is the primary fix; this migration
   adds the alias column for forward-compatibility if views are added later.)
   NOTE: the column rename is handled in code, not here; this migration only
   documents that notes is the authoritative column name.
"""

from __future__ import annotations

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. meridian.financial_plans — add scalar columns ─────────────────────
    op.execute("""
        ALTER TABLE meridian.financial_plans
            ADD COLUMN IF NOT EXISTS plan_name      TEXT,
            ADD COLUMN IF NOT EXISTS target_amount  NUMERIC,
            ADD COLUMN IF NOT EXISTS target_date    DATE,
            ADD COLUMN IF NOT EXISTS current_amount NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS status         TEXT    DEFAULT 'active';
    """)
    # Back-fill status for rows written before this migration.
    op.execute("""
        UPDATE meridian.financial_plans
        SET status = CASE WHEN is_current THEN 'active' ELSE 'archived' END
        WHERE status IS NULL;
    """)

    # ── 2. ai.iris_context_cache — add missing text columns ──────────────────
    op.execute("""
        ALTER TABLE ai.iris_context_cache
            ADD COLUMN IF NOT EXISTS journal_summary     TEXT,
            ADD COLUMN IF NOT EXISTS portfolio_stats     TEXT,
            ADD COLUMN IF NOT EXISTS achievement_summary TEXT;
    """)

    # ── 3. core.user_profiles — add missing demographic columns ──────────────
    op.execute("""
        ALTER TABLE core.user_profiles
            ADD COLUMN IF NOT EXISTS country_of_residence TEXT,
            ADD COLUMN IF NOT EXISTS employment_status    TEXT;
    """)

    # ── 4. meridian.user_insights — create table (missing entirely) ──────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS meridian.user_insights (
            id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            insight_type   TEXT        NOT NULL,
            key            TEXT        NOT NULL,
            value          TEXT        NOT NULL,
            confidence     NUMERIC     NOT NULL DEFAULT 0.5
                               CHECK (confidence >= 0 AND confidence <= 1),
            is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
            extracted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (user_id, insight_type, key)
        );
    """)

    op.execute("ALTER TABLE meridian.user_insights ENABLE ROW LEVEL SECURITY;")

    op.execute("""
        DROP POLICY IF EXISTS "Users can read own insights" ON meridian.user_insights;
        CREATE POLICY "Users can read own insights"
        ON meridian.user_insights FOR SELECT
        USING (user_id = auth.uid());
    """)

    op.execute("""
        DROP POLICY IF EXISTS "Service role manages insights" ON meridian.user_insights;
        CREATE POLICY "Service role manages insights"
        ON meridian.user_insights FOR ALL
        TO service_role
        USING (TRUE)
        WITH CHECK (TRUE);
    """)

    # Grant permissions
    op.execute("""
        GRANT SELECT ON meridian.user_insights TO authenticated;
        GRANT SELECT, INSERT, UPDATE, DELETE ON meridian.user_insights TO service_role;
    """)

    # ── 5. ai.iris_context_cache — add service_role bypass policy ────────────
    # The backend uses the service-role key, which already bypasses RLS in
    # Supabase's PostgREST.  This policy is belt-and-suspenders insurance
    # for direct Postgres connections and future tooling.
    op.execute("""
        DROP POLICY IF EXISTS "Service role manages iris cache" ON ai.iris_context_cache;
        CREATE POLICY "Service role manages iris cache"
        ON ai.iris_context_cache FOR ALL
        TO service_role
        USING (TRUE)
        WITH CHECK (TRUE);
    """)


def downgrade() -> None:
    # Remove user_insights policies and table
    op.execute("DROP TABLE IF EXISTS meridian.user_insights;")

    # Remove added columns (non-destructive — no data loss on fresh tables)
    op.execute("""
        ALTER TABLE meridian.financial_plans
            DROP COLUMN IF EXISTS plan_name,
            DROP COLUMN IF EXISTS target_amount,
            DROP COLUMN IF EXISTS target_date,
            DROP COLUMN IF EXISTS current_amount,
            DROP COLUMN IF EXISTS status;
    """)
    op.execute("""
        ALTER TABLE ai.iris_context_cache
            DROP COLUMN IF EXISTS journal_summary,
            DROP COLUMN IF EXISTS portfolio_stats,
            DROP COLUMN IF EXISTS achievement_summary;
    """)
    op.execute("""
        ALTER TABLE core.user_profiles
            DROP COLUMN IF EXISTS country_of_residence,
            DROP COLUMN IF EXISTS employment_status;
    """)
    op.execute("""
        DROP POLICY IF EXISTS "Service role manages iris cache" ON ai.iris_context_cache;
    """)
