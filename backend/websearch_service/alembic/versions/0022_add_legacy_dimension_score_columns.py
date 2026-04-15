"""Add legacy dimension score columns to market.trending_stocks.

The ranking engine writes technical_score, fundamental_score,
consistency_score, and signal_score to trending_stocks on every cycle,
but the columns were never created.  PostgREST silently drops unknown
keys in the upsert payload, so these four always come back as NULL
and the frontend falls back to 50 (neutral).

Backfill from existing data:
  technical_score   ← trend_score      (trend = technical)
  signal_score      ← momentum_score   (momentum = signal)
  consistency_score ← volume_score     (volume = consistency)
  fundamental_score ← stock_ranking_history.dimension_scores->>'quality_score'
                      (quality = fundamental; sourced from the latest balanced-
                      horizon ranking cycle)
"""
from __future__ import annotations

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE market.trending_stocks
            ADD COLUMN IF NOT EXISTS technical_score    NUMERIC,
            ADD COLUMN IF NOT EXISTS fundamental_score  NUMERIC,
            ADD COLUMN IF NOT EXISTS consistency_score  NUMERIC,
            ADD COLUMN IF NOT EXISTS signal_score       NUMERIC;
    """)
    # Backfill from existing columns so the UI shows real values immediately
    op.execute("""
        UPDATE market.trending_stocks
        SET technical_score   = trend_score,
            signal_score      = momentum_score,
            consistency_score = volume_score
        WHERE technical_score IS NULL;
    """)
    # Backfill fundamental_score from the latest ranking history cycle
    op.execute("""
        UPDATE market.trending_stocks t
        SET fundamental_score = (
            SELECT (h.dimension_scores->>'quality_score')::numeric
            FROM market.stock_ranking_history h
            WHERE h.ticker = t.ticker AND h.horizon = 'balanced'
            ORDER BY h.scored_at DESC
            LIMIT 1
        )
        WHERE t.fundamental_score IS NULL;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE market.trending_stocks
            DROP COLUMN IF EXISTS technical_score,
            DROP COLUMN IF EXISTS fundamental_score,
            DROP COLUMN IF EXISTS consistency_score,
            DROP COLUMN IF EXISTS signal_score;
    """)
