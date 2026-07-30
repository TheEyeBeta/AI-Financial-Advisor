# ADR-008: Atomic Server-Side Paper-Trading Rebuild (RPC), Not Yet Full Server-Side Computation
## Status
Accepted (partial — see Follow-up)

## Context
`buildPaperTradingLedger` (`src/lib/paper-trading-ledger.ts`) computes FIFO lot accounting, cost basis, and P&L for the paper-trading feature entirely in the browser from the user's journal entries. `rebuildPaperTradingState` (`src/services/paper-trading-sync.ts`) then persisted that computed state with 3 parallel `DELETE` calls followed by 2 sequential `INSERT` calls against `trading.open_positions`/`trades`/`portfolio_history` — 5 independent, non-transactional Supabase REST calls from the anon-key browser client.

An architecture audit (rip-apart pass, 2026-07-29) found this was not just theoretically non-atomic but actively broken: `trading.trades` and `trading.portfolio_history` were missing `DELETE` RLS policies (`sql/schema.sql`), so the delete calls silently affected zero rows (standard Postgres RLS behavior — no error). The subsequent `INSERT`, using deterministic IDs derived from the source journal entry, then collided with the leftover rows from the previous rebuild on every second-and-later rebuild for a given user, throwing a duplicate-key/unique-violation error. This is the documented root cause behind the defensive "Journal entry saved but account rebuild failed — do not retry writes" workaround already present in `TradeJournal.tsx:239-252`.

Team size and ops maturity: small team, CI/CD and migration discipline already in place (Alembic-gated schema, RLS-first data access), but no dedicated backend capacity right now for a full trading-engine rewrite.

## Problem
How should the paper-trading ledger be computed and persisted so that (a) a partial failure can never leave a user's trading history empty or duplicated, and (b) the computation is not duplicated/divergent across `OpenPositions.tsx`, `PaperTradingOverview.tsx`, `PortfolioPerformance.tsx`, and `trading-api.ts` (a code comment in this codebase already admits past cross-widget percentage mismatches from this duplication)?

## Decision
Two-part decision, split by risk and effort:

1. **Now (implemented in this pass):** Replace the 5 REST calls with a single atomic RPC, `trading.rebuild_paper_trading_state(p_user_id, p_open_positions, p_trades, p_portfolio_history)` (migration `0043_trading_atomic_rebuild`), which does all deletes and inserts inside one `SECURITY DEFINER` function call — either the whole rebuild lands or none of it does. The missing `DELETE` RLS policies on `trading.trades`/`portfolio_history` are added in the same migration as defense in depth. The ledger math itself (`buildPaperTradingLedger`) is unchanged — this fixes the transaction boundary and the concrete production bug, not the underlying "who owns the computation" question.
2. **Deferred, requires a product decision (not implemented in this pass):** Move P&L/cost-basis computation server-side (e.g., compute inside the same `trading.rebuild_paper_trading_state` RPC from raw journal entries, or a dedicated backend service), with the frontend becoming a pure reader of `trading.open_positions`/`trades`/`portfolio_history`. This is the fix for the duplicated-computation problem (four different components independently re-deriving P&L), but it is real feature work — it changes where a defect in the accounting logic would surface, requires porting and testing FIFO lot-matching logic in SQL or Python, and needs a decision on backward compatibility for any in-flight client state. Out of scope for a "smallest diff" security/correctness pass.

## Alternatives considered
- **Leave the 5-call sequence, just add the missing RLS policies.** Rejected: closes the duplicate-row bug but leaves the non-atomicity — a network failure between deletes and inserts still empties the user's trading history.
- **Move full computation server-side in this same pass.** Rejected for now: correct long-term direction, but a much larger, higher-risk change (porting FIFO accounting logic, re-verifying every P&L figure against the existing client implementation) than the audit's time budget or risk tolerance for an unreviewed, un-QA'd rewrite of financial calculation logic supports. Doing it hastily risks silently wrong P&L numbers, which is worse than the current bug.
- **Client-side optimistic locking / retry with idempotency keys instead of a DB transaction.** Rejected: still leaves multiple partial-failure windows, and Postgres already gives us a real transaction boundary for free via a single RPC call — no reason to reimplement weaker semantics in the client.

## Consequences
- Positive: the observed "rebuild fails after the first journal entry" bug is fixed at its root (missing RLS policy + non-atomic writes), verified via `alembic upgrade head`/`alembic check` on a disposable Postgres.
- Positive: the atomic RPC pattern matches this codebase's existing `ai.complete_chat_turn` (0032) convention, so it's not a new idiom to maintain.
- Negative: the ledger computation itself is still client-side and still duplicated across four components — the audit's underlying "which number is real" risk remains until the deferred step above is scheduled.
- Risk / revisit trigger: if another cross-widget P&L mismatch is reported in production, that's the signal to schedule the deferred server-side-computation step rather than patching another display component individually.
