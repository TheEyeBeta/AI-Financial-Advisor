"""Positive-value constraints and oversell protection for trading tables (#207).

Remediation-first: rows that violate the new invariants are copied into
``trading.constraint_remediation_audit`` (full row as JSONB) before being
deleted or nulled, so nothing is silently destroyed and every fix is
reviewable. Constraints are added only after remediation, so validation
cannot fail mid-deploy.

Layered enforcement:
- CHECK constraints: quantity/price must be positive on open_positions,
  trades, and trade_journal; portfolio value non-negative.
  (trading.paper_trades / paper_trade_closes already carry positive CHECKs
  from the runtime baseline.)
- Oversell protection: the app's source of truth for paper trading is
  trading.trade_journal (BUY/SELL rows). A BEFORE trigger serializes
  concurrent writes per (user, symbol) with an advisory xact lock and
  rejects SELLs exceeding the open quantity. The legacy
  paper_trade_closes path gets the same guard via a row lock on the
  parent paper_trades row.
"""

from alembic import op

revision = "0034_trading_constraints"
down_revision = "0033_chat_pagination"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- ── Remediation audit table ─────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS trading.constraint_remediation_audit (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            source_table TEXT NOT NULL,
            source_row_id UUID,
            row_data JSONB NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('deleted', 'nulled_column', 'clamped')),
            reason TEXT NOT NULL,
            detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        -- Operators only; no client role access.
        ALTER TABLE trading.constraint_remediation_audit ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON trading.constraint_remediation_audit FROM anon, authenticated;

        -- ── Remediate pre-existing invalid rows (audit first, then fix) ─────
        WITH bad AS (
            SELECT * FROM trading.open_positions WHERE quantity <= 0 OR entry_price <= 0
        ), audited AS (
            INSERT INTO trading.constraint_remediation_audit (source_table, source_row_id, row_data, action, reason)
            SELECT 'trading.open_positions', bad.id, to_jsonb(bad), 'deleted', 'non-positive quantity or entry_price'
            FROM bad
        )
        DELETE FROM trading.open_positions
        WHERE quantity <= 0 OR entry_price <= 0;

        WITH bad AS (
            SELECT * FROM trading.open_positions WHERE current_price IS NOT NULL AND current_price <= 0
        ), audited AS (
            INSERT INTO trading.constraint_remediation_audit (source_table, source_row_id, row_data, action, reason)
            SELECT 'trading.open_positions', bad.id, to_jsonb(bad), 'nulled_column', 'non-positive current_price set to NULL'
            FROM bad
        )
        UPDATE trading.open_positions SET current_price = NULL
        WHERE current_price IS NOT NULL AND current_price <= 0;

        WITH bad AS (
            SELECT * FROM trading.trades WHERE quantity <= 0 OR entry_price <= 0
        ), audited AS (
            INSERT INTO trading.constraint_remediation_audit (source_table, source_row_id, row_data, action, reason)
            SELECT 'trading.trades', bad.id, to_jsonb(bad), 'deleted', 'non-positive quantity or entry_price'
            FROM bad
        )
        DELETE FROM trading.trades
        WHERE quantity <= 0 OR entry_price <= 0;

        WITH bad AS (
            SELECT * FROM trading.trades WHERE exit_price IS NOT NULL AND exit_price <= 0
        ), audited AS (
            INSERT INTO trading.constraint_remediation_audit (source_table, source_row_id, row_data, action, reason)
            SELECT 'trading.trades', bad.id, to_jsonb(bad), 'nulled_column', 'non-positive exit_price set to NULL'
            FROM bad
        )
        UPDATE trading.trades SET exit_price = NULL
        WHERE exit_price IS NOT NULL AND exit_price <= 0;

        WITH bad AS (
            SELECT * FROM trading.trade_journal WHERE quantity <= 0 OR price <= 0
        ), audited AS (
            INSERT INTO trading.constraint_remediation_audit (source_table, source_row_id, row_data, action, reason)
            SELECT 'trading.trade_journal', bad.id, to_jsonb(bad), 'deleted', 'non-positive quantity or price'
            FROM bad
        )
        DELETE FROM trading.trade_journal
        WHERE quantity <= 0 OR price <= 0;

        WITH bad AS (
            SELECT * FROM trading.portfolio_history WHERE value < 0
        ), audited AS (
            INSERT INTO trading.constraint_remediation_audit (source_table, source_row_id, row_data, action, reason)
            SELECT 'trading.portfolio_history', bad.id, to_jsonb(bad), 'clamped', 'negative portfolio value clamped to 0'
            FROM bad
        )
        UPDATE trading.portfolio_history SET value = 0 WHERE value < 0;

        -- ── CHECK constraints (database is the final authority) ─────────────
        ALTER TABLE trading.open_positions
            DROP CONSTRAINT IF EXISTS open_positions_quantity_positive,
            DROP CONSTRAINT IF EXISTS open_positions_entry_price_positive,
            DROP CONSTRAINT IF EXISTS open_positions_current_price_positive;
        ALTER TABLE trading.open_positions
            ADD CONSTRAINT open_positions_quantity_positive CHECK (quantity > 0),
            ADD CONSTRAINT open_positions_entry_price_positive CHECK (entry_price > 0),
            ADD CONSTRAINT open_positions_current_price_positive
                CHECK (current_price IS NULL OR current_price > 0);

        ALTER TABLE trading.trades
            DROP CONSTRAINT IF EXISTS trades_quantity_positive,
            DROP CONSTRAINT IF EXISTS trades_entry_price_positive,
            DROP CONSTRAINT IF EXISTS trades_exit_price_positive;
        ALTER TABLE trading.trades
            ADD CONSTRAINT trades_quantity_positive CHECK (quantity > 0),
            ADD CONSTRAINT trades_entry_price_positive CHECK (entry_price > 0),
            ADD CONSTRAINT trades_exit_price_positive
                CHECK (exit_price IS NULL OR exit_price > 0);

        ALTER TABLE trading.trade_journal
            DROP CONSTRAINT IF EXISTS trade_journal_quantity_positive,
            DROP CONSTRAINT IF EXISTS trade_journal_price_positive;
        ALTER TABLE trading.trade_journal
            ADD CONSTRAINT trade_journal_quantity_positive CHECK (quantity > 0),
            ADD CONSTRAINT trade_journal_price_positive CHECK (price > 0);

        ALTER TABLE trading.portfolio_history
            DROP CONSTRAINT IF EXISTS portfolio_history_value_non_negative;
        ALTER TABLE trading.portfolio_history
            ADD CONSTRAINT portfolio_history_value_non_negative CHECK (value >= 0);

        -- ── Oversell protection: trade_journal (active paper-trading path) ──
        -- Shorting is not supported: a SELL may never exceed the currently
        -- open quantity for (user, symbol). The advisory xact lock serializes
        -- concurrent journal writes for the same user+symbol so two
        -- simultaneous SELLs cannot both pass the availability check.
        CREATE OR REPLACE FUNCTION trading.enforce_journal_sell_within_position()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = trading, pg_temp
        AS $$
        DECLARE
            available INTEGER;
        BEGIN
            IF NEW.type <> 'SELL' THEN
                RETURN NEW;
            END IF;

            PERFORM pg_advisory_xact_lock(
                hashtextextended('trading.trade_journal:' || NEW.user_id::text || ':' || upper(NEW.symbol), 0)
            );

            SELECT COALESCE(SUM(CASE WHEN type = 'BUY' THEN quantity ELSE -quantity END), 0)
            INTO available
            FROM trading.trade_journal
            WHERE user_id = NEW.user_id
              AND upper(symbol) = upper(NEW.symbol)
              AND id IS DISTINCT FROM NEW.id;

            IF NEW.quantity > available THEN
                RAISE EXCEPTION
                    'Cannot sell % shares of %: only % open (shorting is not supported)',
                    NEW.quantity, upper(NEW.symbol), GREATEST(available, 0)
                    USING ERRCODE = '23514';
            END IF;

            RETURN NEW;
        END;
        $$;

        DROP TRIGGER IF EXISTS trg_trade_journal_no_oversell ON trading.trade_journal;
        CREATE TRIGGER trg_trade_journal_no_oversell
            BEFORE INSERT OR UPDATE OF quantity, type, symbol ON trading.trade_journal
            FOR EACH ROW
            EXECUTE FUNCTION trading.enforce_journal_sell_within_position();

        -- ── Oversell protection: legacy paper_trade_closes path ─────────────
        -- The FOR UPDATE row lock on the parent buy serializes concurrent
        -- closes of the same position.
        CREATE OR REPLACE FUNCTION trading.enforce_paper_close_within_position()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = trading, pg_temp
        AS $$
        DECLARE
            buy RECORD;
            already_closed INTEGER;
        BEGIN
            SELECT id, user_id, buy_quantity, status
            INTO buy
            FROM trading.paper_trades
            WHERE id = NEW.buy_trade_id
            FOR UPDATE;

            IF buy.id IS NULL THEN
                RAISE EXCEPTION 'Buy trade % not found', NEW.buy_trade_id USING ERRCODE = '23503';
            END IF;
            IF buy.user_id <> NEW.user_id THEN
                RAISE EXCEPTION 'Close does not belong to the owner of buy trade %', NEW.buy_trade_id
                    USING ERRCODE = '42501';
            END IF;

            SELECT COALESCE(SUM(close_quantity), 0)
            INTO already_closed
            FROM trading.paper_trade_closes
            WHERE buy_trade_id = NEW.buy_trade_id
              AND id IS DISTINCT FROM NEW.id;

            IF NEW.close_quantity > buy.buy_quantity - already_closed THEN
                RAISE EXCEPTION
                    'Cannot close % shares: only % of % remain open on trade %',
                    NEW.close_quantity, buy.buy_quantity - already_closed, buy.buy_quantity, NEW.buy_trade_id
                    USING ERRCODE = '23514';
            END IF;

            RETURN NEW;
        END;
        $$;

        DROP TRIGGER IF EXISTS trg_paper_trade_closes_no_oversell ON trading.paper_trade_closes;
        CREATE TRIGGER trg_paper_trade_closes_no_oversell
            BEFORE INSERT OR UPDATE OF close_quantity, buy_trade_id ON trading.paper_trade_closes
            FOR EACH ROW
            EXECUTE FUNCTION trading.enforce_paper_close_within_position();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_paper_trade_closes_no_oversell ON trading.paper_trade_closes;
        DROP FUNCTION IF EXISTS trading.enforce_paper_close_within_position();
        DROP TRIGGER IF EXISTS trg_trade_journal_no_oversell ON trading.trade_journal;
        DROP FUNCTION IF EXISTS trading.enforce_journal_sell_within_position();

        ALTER TABLE trading.portfolio_history
            DROP CONSTRAINT IF EXISTS portfolio_history_value_non_negative;
        ALTER TABLE trading.trade_journal
            DROP CONSTRAINT IF EXISTS trade_journal_quantity_positive,
            DROP CONSTRAINT IF EXISTS trade_journal_price_positive;
        ALTER TABLE trading.trades
            DROP CONSTRAINT IF EXISTS trades_quantity_positive,
            DROP CONSTRAINT IF EXISTS trades_entry_price_positive,
            DROP CONSTRAINT IF EXISTS trades_exit_price_positive;
        ALTER TABLE trading.open_positions
            DROP CONSTRAINT IF EXISTS open_positions_quantity_positive,
            DROP CONSTRAINT IF EXISTS open_positions_entry_price_positive,
            DROP CONSTRAINT IF EXISTS open_positions_current_price_positive;

        -- The remediation audit table is intentionally KEPT on downgrade:
        -- it is the only record of rows altered during remediation.
        """
    )
