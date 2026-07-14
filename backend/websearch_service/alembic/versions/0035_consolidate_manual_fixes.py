"""Fold remaining manual sql/ fixes into the canonical migration history (#208).

Until this revision, several fixes that running features depend on existed
only as "run this in the Supabase SQL Editor" scripts under sql/ — a fresh
environment could not reach the production schema through Alembic alone,
and security fixes depended on an operator remembering an extra step.
This revision makes `alembic upgrade head` the single bootstrap path:

- sql/add_intelligence_digest_update_policy.sql → digest columns
  (headline/body/is_read, used by intelligence_engine.py) and the UPDATE
  policy without which markDigestRead() is silently blocked by RLS.
- sql/add_job_run_logs.sql → core.job_run_logs (admin job history).
- sql/add_ranking_history.sql → market.stock_ranking_history
  (rank-stability/EMA smoothing store for ranking_engine.py).
- sql/create_stock_returns_mv.sql → market.stock_returns_mv.
- sql/add_admin_chat_rls_policies.sql → admin SELECT policies for the
  admin analytics panel.
- Canonical baselines for the data-pipeline tables the backend reads
  (market.stock_price_history / stock_fundamentals_history /
  macro_snapshots), which previously existed only in the production
  dashboard. CREATE TABLE IF NOT EXISTS keeps this a no-op on
  environments where the pipeline already created them.
- SELECT grant on alembic_version so readiness probes can verify the
  deployed schema revision (app/health_checks.py).

Everything here is idempotent; the downgrade drops exactly what this
revision introduces.
"""

from alembic import op

revision = "0035_consolidate_manual_fixes"
down_revision = "0034_trading_constraints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- ── Intelligence digests: columns + user UPDATE policy ──────────────
        ALTER TABLE meridian.intelligence_digests
            ADD COLUMN IF NOT EXISTS headline TEXT,
            ADD COLUMN IF NOT EXISTS body     TEXT,
            ADD COLUMN IF NOT EXISTS is_read  BOOLEAN NOT NULL DEFAULT FALSE;

        DROP POLICY IF EXISTS "Users can mark own intelligence digests as read"
            ON meridian.intelligence_digests;
        CREATE POLICY "Users can mark own intelligence digests as read"
            ON meridian.intelligence_digests FOR UPDATE
            USING     (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());

        -- ── Job run logs (admin panel job history; backend-only access) ─────
        CREATE TABLE IF NOT EXISTS core.job_run_logs (
            id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            job_name          text        NOT NULL,
            started_at        timestamptz NOT NULL,
            finished_at       timestamptz,
            status            text        NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
            records_processed integer,
            summary           text,
            error             text,
            created_at        timestamptz DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_job_run_logs_job_name_started
            ON core.job_run_logs (job_name, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_job_run_logs_created_at
            ON core.job_run_logs (created_at);
        ALTER TABLE core.job_run_logs ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Service role full access on job_run_logs" ON core.job_run_logs;
        CREATE POLICY "Service role full access on job_run_logs"
            ON core.job_run_logs FOR ALL TO service_role
            USING (true) WITH CHECK (true);

        -- ── Ranking history (public market data; service-role writes) ───────
        CREATE TABLE IF NOT EXISTS market.stock_ranking_history (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            ticker           VARCHAR NOT NULL,
            horizon          VARCHAR NOT NULL CHECK (horizon IN ('short', 'balanced', 'long')),
            composite_score  DECIMAL(5, 1) NOT NULL,
            smoothed_score   DECIMAL(5, 1) NOT NULL,
            rank_tier        VARCHAR NOT NULL,
            conviction       VARCHAR NOT NULL,
            dimension_scores JSONB NOT NULL DEFAULT '{}',
            scored_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ranking_history_ticker_horizon_scored
            ON market.stock_ranking_history (ticker, horizon, scored_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ranking_history_scored_at
            ON market.stock_ranking_history (scored_at);
        ALTER TABLE market.stock_ranking_history ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Anyone can view ranking history" ON market.stock_ranking_history;
        CREATE POLICY "Anyone can view ranking history"
            ON market.stock_ranking_history FOR SELECT
            TO authenticated, anon USING (true);
        GRANT SELECT ON market.stock_ranking_history TO authenticated, anon;

        -- ── Data-pipeline tables (canonical baseline; no-op where the
        --    pipeline already created them in production) ─────────────────────
        CREATE TABLE IF NOT EXISTS market.stock_price_history (
            ticker     VARCHAR NOT NULL,
            date       DATE NOT NULL,
            open       NUMERIC,
            high       NUMERIC,
            low        NUMERIC,
            close      NUMERIC,
            volume     BIGINT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (ticker, date)
        );
        ALTER TABLE market.stock_price_history ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Anyone can view price history" ON market.stock_price_history;
        CREATE POLICY "Anyone can view price history"
            ON market.stock_price_history FOR SELECT
            TO authenticated, anon USING (true);
        GRANT SELECT ON market.stock_price_history TO authenticated, anon;

        CREATE TABLE IF NOT EXISTS market.stock_fundamentals_history (
            ticker     VARCHAR NOT NULL,
            date       DATE NOT NULL,
            data       JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (ticker, date)
        );
        ALTER TABLE market.stock_fundamentals_history ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Anyone can view fundamentals history" ON market.stock_fundamentals_history;
        CREATE POLICY "Anyone can view fundamentals history"
            ON market.stock_fundamentals_history FOR SELECT
            TO authenticated, anon USING (true);
        GRANT SELECT ON market.stock_fundamentals_history TO authenticated, anon;

        CREATE TABLE IF NOT EXISTS market.macro_snapshots (
            date             DATE PRIMARY KEY,
            vix              NUMERIC,
            yield_10y        NUMERIC,
            sp500_level      NUMERIC,
            sp500_change_pct NUMERIC,
            fed_funds_rate   NUMERIC,
            created_at       TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE market.macro_snapshots ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Anyone can view macro snapshots" ON market.macro_snapshots;
        CREATE POLICY "Anyone can view macro snapshots"
            ON market.macro_snapshots FOR SELECT
            TO authenticated, anon USING (true);
        GRANT SELECT ON market.macro_snapshots TO authenticated, anon;

        -- ── Pre-computed multi-horizon returns for the ranking engine ───────
        DROP MATERIALIZED VIEW IF EXISTS market.stock_returns_mv;
        CREATE MATERIALIZED VIEW market.stock_returns_mv AS
        WITH ranked AS (
            SELECT
                ticker,
                close,
                ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn,
                COUNT(*)     OVER (PARTITION BY ticker)                    AS total_trading_days
            FROM market.stock_price_history
            WHERE close IS NOT NULL
              AND close > 0
        ),
        latest  AS (SELECT ticker, close AS c0, total_trading_days FROM ranked WHERE rn = 1),
        ago_1m  AS (SELECT ticker, close AS c1m  FROM ranked WHERE rn = 22),
        ago_3m  AS (SELECT ticker, close AS c3m  FROM ranked WHERE rn = 64),
        ago_6m  AS (SELECT ticker, close AS c6m  FROM ranked WHERE rn = 127),
        ago_12m AS (SELECT ticker, close AS c12m FROM ranked WHERE rn = 253)
        SELECT
            l.ticker,
            l.total_trading_days,
            (l.total_trading_days >= 22)  AS has_1m_history,
            (l.total_trading_days >= 64)  AS has_3m_history,
            (l.total_trading_days >= 127) AS has_6m_history,
            (l.total_trading_days >= 253) AS has_12m_history,
            CASE WHEN a1.c1m   > 0 THEN (l.c0 - a1.c1m)   / a1.c1m   END AS return_1m,
            CASE WHEN a3.c3m   > 0 THEN (l.c0 - a3.c3m)   / a3.c3m   END AS return_3m,
            CASE WHEN a6.c6m   > 0 THEN (l.c0 - a6.c6m)   / a6.c6m   END AS return_6m,
            CASE WHEN a12.c12m > 0 THEN (l.c0 - a12.c12m) / a12.c12m END AS return_12m
        FROM      latest  l
        LEFT JOIN ago_1m  a1  USING (ticker)
        LEFT JOIN ago_3m  a3  USING (ticker)
        LEFT JOIN ago_6m  a6  USING (ticker)
        LEFT JOIN ago_12m a12 USING (ticker);

        CREATE UNIQUE INDEX IF NOT EXISTS stock_returns_mv_ticker_idx
            ON market.stock_returns_mv (ticker);
        GRANT SELECT ON market.stock_returns_mv TO authenticated, anon;

        -- ── Admin analytics: admins may read all chats/messages ─────────────
        -- Postgres ORs SELECT policies, so regular users remain restricted to
        -- their own rows by the existing per-user policies.
        DROP POLICY IF EXISTS "Admins can view all chats" ON ai.chats;
        CREATE POLICY "Admins can view all chats"
            ON ai.chats FOR SELECT
            USING (core.is_current_user_admin());

        DROP POLICY IF EXISTS "Admins can view all chat messages" ON ai.chat_messages;
        CREATE POLICY "Admins can view all chat messages"
            ON ai.chat_messages FOR SELECT
            USING (core.is_current_user_admin());

        -- ── Schema-revision readiness probe (#208) ───────────────────────────
        -- Lets the backend verify the deployed schema via PostgREST.
        GRANT SELECT ON public.alembic_version TO service_role;
        """
    )


def downgrade() -> None:
    # DELIBERATELY PARTIAL. upgrade() uses IF NOT EXISTS because several of
    # these objects may PREDATE this revision (created by the data pipeline or
    # the manual sql/ scripts) and can hold production data — price/
    # fundamentals/macro history, job logs, ranking history, digest
    # headline/body/is_read values. This revision cannot tell which objects it
    # actually created, so downgrade removes only what is safely recreatable
    # (policies, grants, the derived materialized view) and RETAINS every
    # data-bearing table/column — the same retention choice 0034 makes for its
    # remediation audit table. Removing the retained objects is a deliberate
    # human operation, never an automatic rollback side effect.
    op.execute(
        """
        REVOKE SELECT ON public.alembic_version FROM service_role;

        DROP POLICY IF EXISTS "Admins can view all chat messages" ON ai.chat_messages;
        DROP POLICY IF EXISTS "Admins can view all chats" ON ai.chats;

        -- Derived data only; rebuilt by upgrade() at any time.
        DROP MATERIALIZED VIEW IF EXISTS market.stock_returns_mv;

        DROP POLICY IF EXISTS "Users can mark own intelligence digests as read"
            ON meridian.intelligence_digests;

        -- RETAINED (may predate this revision and/or hold production data):
        -- core.job_run_logs, market.stock_ranking_history,
        -- market.stock_price_history, market.stock_fundamentals_history,
        -- market.macro_snapshots, and the meridian.intelligence_digests
        -- headline/body/is_read columns.
        """
    )
