"""Atomic paper-trading rebuild RPC + missing DELETE policies.

Architecture audit (rip-apart pass) found two compounding bugs in the paper
trading sync path:

1. `trading.trades` and `trading.portfolio_history` were created
   (`sql/schema.sql`) with SELECT/INSERT/UPDATE RLS policies but **no
   DELETE policy** — unlike `trading.open_positions`, which has all four.
   With RLS enabled and no matching policy, DELETE affects zero rows and
   returns no error (standard Postgres RLS behavior, not a client-visible
   failure).
2. `src/services/paper-trading-sync.ts` (`rebuildPaperTradingState`)
   recomputes a user's full trade/position/history state client-side, then
   issues 3 parallel `DELETE ... WHERE user_id = ?` calls followed by 2
   sequential `INSERT` calls — 5 separate non-transactional Supabase REST
   calls, each using deterministic IDs derived from the source journal
   entry (`trade.id = journalEntry.id`) or a `UNIQUE(user_id, date)`
   constraint (`portfolio_history`).

Combined, these mean: the `trades`/`portfolio_history` DELETE calls above
silently delete nothing (bug 1), so the following INSERT of the freshly
recomputed rows collides with the *same* primary key / unique constraint
left over from the previous rebuild — every rebuild after the first one
for a given user fails with a duplicate-key/unique-violation error. This
matches the defensive "Journal entry saved but account rebuild failed —
do not retry writes" workaround already present in
`TradeJournal.tsx:239-252`, which papers over the symptom rather than the
cause. Even with the DELETE policies fixed, 5 independent REST calls are
still not atomic: a network failure between the deletes and the inserts
leaves the user's trading history empty.

Fix:
* Add the missing DELETE policies on `trading.trades` and
  `trading.portfolio_history` (mirrors `trading.open_positions`), closing
  the RLS gap that made bug 1 possible in the first place — defense in
  depth even though the RPC below uses SECURITY DEFINER.
* Add `trading.rebuild_paper_trading_state(p_user_id, p_open_positions,
  p_trades, p_portfolio_history)` — a single SECURITY DEFINER function
  (pattern matches `ai.complete_chat_turn`, 0032) that does all 3 deletes
  and 3 inserts inside one implicit transaction: either the whole rebuild
  lands, or none of it does. Caller identity is resolved from `auth.uid()`
  internally and must match `p_user_id`, so a caller can only ever rebuild
  their own state regardless of what the client sends.

The frontend call site (`paper-trading-sync.ts`) is updated in the same
change to call this RPC instead of the 5 raw calls.
"""
from __future__ import annotations

from alembic import op

revision = "0043_trading_atomic_rebuild"
down_revision = "0042_chat_turn_user_id_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Close the missing-DELETE-policy gap (defense in depth) ──────────────
    op.execute(
        """
        DROP POLICY IF EXISTS "Users can delete own trades" ON trading.trades;
        CREATE POLICY "Users can delete own trades"
        ON trading.trades FOR DELETE
        USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));

        DROP POLICY IF EXISTS "Users can delete own portfolio history"
            ON trading.portfolio_history;
        CREATE POLICY "Users can delete own portfolio history"
        ON trading.portfolio_history FOR DELETE
        USING (user_id IN (SELECT id FROM core.users WHERE auth_id = auth.uid()));
        """
    )

    # ── Atomic rebuild RPC ────────────────────────────────────────────────
    op.execute(
        """
        CREATE OR REPLACE FUNCTION trading.rebuild_paper_trading_state(
            p_user_id UUID,
            p_open_positions JSONB,
            p_trades JSONB,
            p_portfolio_history JSONB
        )
        RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = trading, core, pg_temp
        AS $$
        DECLARE
            caller_user_id UUID;
        BEGIN
            SELECT id INTO caller_user_id FROM core.users WHERE auth_id = auth.uid();

            IF caller_user_id IS NULL THEN
                RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
            END IF;

            IF p_user_id IS DISTINCT FROM caller_user_id THEN
                RAISE EXCEPTION 'Not authorized for this user' USING ERRCODE = '42501';
            END IF;

            DELETE FROM trading.open_positions WHERE user_id = caller_user_id;
            DELETE FROM trading.trades WHERE user_id = caller_user_id;
            DELETE FROM trading.portfolio_history WHERE user_id = caller_user_id;

            INSERT INTO trading.open_positions (
                id, user_id, symbol, name, quantity, entry_price,
                current_price, type, entry_date, created_at, updated_at
            )
            SELECT
                (elem->>'id')::uuid,
                caller_user_id,
                elem->>'symbol',
                elem->>'name',
                (elem->>'quantity')::integer,
                (elem->>'entry_price')::decimal,
                NULLIF(elem->>'current_price', '')::decimal,
                elem->>'type',
                (elem->>'entry_date')::timestamptz,
                COALESCE((elem->>'created_at')::timestamptz, NOW()),
                COALESCE((elem->>'updated_at')::timestamptz, NOW())
            FROM jsonb_array_elements(COALESCE(p_open_positions, '[]'::jsonb)) elem;

            INSERT INTO trading.trades (
                id, user_id, symbol, type, action, quantity, entry_price,
                exit_price, entry_date, exit_date, pnl, created_at, updated_at
            )
            SELECT
                (elem->>'id')::uuid,
                caller_user_id,
                elem->>'symbol',
                elem->>'type',
                elem->>'action',
                (elem->>'quantity')::integer,
                (elem->>'entry_price')::decimal,
                NULLIF(elem->>'exit_price', '')::decimal,
                (elem->>'entry_date')::timestamptz,
                NULLIF(elem->>'exit_date', '')::timestamptz,
                NULLIF(elem->>'pnl', '')::decimal,
                COALESCE((elem->>'created_at')::timestamptz, NOW()),
                COALESCE((elem->>'updated_at')::timestamptz, NOW())
            FROM jsonb_array_elements(COALESCE(p_trades, '[]'::jsonb)) elem;

            INSERT INTO trading.portfolio_history (user_id, date, value, created_at)
            SELECT
                caller_user_id,
                (elem->>'date')::date,
                (elem->>'value')::decimal,
                COALESCE((elem->>'created_at')::timestamptz, NOW())
            FROM jsonb_array_elements(COALESCE(p_portfolio_history, '[]'::jsonb)) elem;
        END;
        $$;

        REVOKE EXECUTE ON FUNCTION trading.rebuild_paper_trading_state(uuid, jsonb, jsonb, jsonb)
            FROM PUBLIC, anon;
        GRANT EXECUTE ON FUNCTION trading.rebuild_paper_trading_state(uuid, jsonb, jsonb, jsonb)
            TO authenticated;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP FUNCTION IF EXISTS trading.rebuild_paper_trading_state(uuid, jsonb, jsonb, jsonb);
        DROP POLICY IF EXISTS "Users can delete own trades" ON trading.trades;
        DROP POLICY IF EXISTS "Users can delete own portfolio history"
            ON trading.portfolio_history;
        """
    )
