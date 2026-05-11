"""Add stability/volatility/20d-momentum columns to market.trending_stocks.

Revision 0026 — follows 0025_create_meridian_goal_progress (main already had
0024 cascade delete + 0025 goal_progress).

The ranking engine scores a stability dimension derived from 20-period
Bollinger band width on each ticker, plus hard quality gates.

Columns added (all NULL-able so historic rows remain readable):

  stability_score   NUMERIC(5,2)
  volatility_20d    NUMERIC(8,6)
  momentum_20d_pct  NUMERIC(8,4)
  hard_filter_passed BOOLEAN
"""

from __future__ import annotations

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE market.trending_stocks
            ADD COLUMN IF NOT EXISTS stability_score    NUMERIC(5,2),
            ADD COLUMN IF NOT EXISTS volatility_20d     NUMERIC(8,6),
            ADD COLUMN IF NOT EXISTS momentum_20d_pct   NUMERIC(8,4),
            ADD COLUMN IF NOT EXISTS hard_filter_passed BOOLEAN;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE market.trending_stocks
            DROP COLUMN IF EXISTS stability_score,
            DROP COLUMN IF EXISTS volatility_20d,
            DROP COLUMN IF EXISTS momentum_20d_pct,
            DROP COLUMN IF EXISTS hard_filter_passed;
    """)
