"""Add trend/volume/range/adx score columns to market.trending_stocks.

The ranking engine (ranking_engine.py) writes trend_score, volume_score,
range_score, and adx_score to market.trending_stocks during each cycle.
These columns were absent from the table, causing every PostgREST upsert to
fail with a 400 (unknown column) and leaving ranked_at frozen at the last
pre-code-change cycle date.

No changes to market.stock_ranking_history — _persist_ranking_history is being
updated separately to match that table's existing schema (scored_at, dimension_scores).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE market.trending_stocks
            ADD COLUMN IF NOT EXISTS trend_score  NUMERIC,
            ADD COLUMN IF NOT EXISTS volume_score NUMERIC,
            ADD COLUMN IF NOT EXISTS range_score  NUMERIC,
            ADD COLUMN IF NOT EXISTS adx_score    NUMERIC;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE market.trending_stocks
            DROP COLUMN IF EXISTS trend_score,
            DROP COLUMN IF EXISTS volume_score,
            DROP COLUMN IF EXISTS range_score,
            DROP COLUMN IF EXISTS adx_score;
    """)
