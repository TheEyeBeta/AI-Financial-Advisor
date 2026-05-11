"""Add stability/volatility/20d-momentum columns to market.trending_stocks.

The ranking engine now scores a sixth dimension — stability — derived from
20-period Bollinger band width on each ticker.  This eliminates the
overnight-spike bias in the previous five-dimension composite by rewarding
low-volatility quality names over short-squeeze movers.

Columns added (all NULL-able so historic rows remain readable):

  stability_score   NUMERIC(5,2)   0-100 normalised inverse volatility
  volatility_20d    NUMERIC(8,6)   Raw band-width ratio (auxiliary output,
                                   useful for position sizing / charts)
  momentum_20d_pct  NUMERIC(8,4)   ~20-trading-day return, expressed as a
                                   percentage.  Surfaced as the headline
                                   percentage in the redesigned TopStocks UI.
  hard_filter_passed BOOLEAN       True when the row passed the new price /
                                   market-cap / liquidity gates.  Stored for
                                   observability; the ranking engine still
                                   filters before scoring.

No data is dropped or renamed.  The ranking engine populates the new
columns on the next cycle; existing top-50 rows from prior cycles retain
their values until refreshed.
"""

from __future__ import annotations

from alembic import op

revision = "0024"
down_revision = "0023"
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
