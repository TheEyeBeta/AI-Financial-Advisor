import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { buildPaperTradingLedger } from "@/lib/paper-trading-ledger";
import { stockSnapshotsApi } from "@/services/stock-snapshots-api";
import type { TradeJournalEntry } from "@/types/database";

export async function rebuildPaperTradingState(
  userId: string,
  journalEntries: TradeJournalEntry[],
) {
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const symbols = Array.from(
    new Set(journalEntries.map((entry) => entry.symbol.trim().toUpperCase()).filter(Boolean)),
  ).sort();

  let snapshotPriceBySymbol = new Map<string, number>();

  if (symbols.length > 0) {
    try {
      const snapshots = await stockSnapshotsApi.getByTickers(symbols);
      snapshotPriceBySymbol = new Map(
        snapshots
          .filter((snapshot) => typeof snapshot.last_price === "number")
          .map((snapshot) => [snapshot.ticker.toUpperCase(), snapshot.last_price as number]),
      );
    } catch (error) {
      console.warn("[paper-trading-sync] Failed to load stock snapshots:", error);
    }
  }

  const ledger = buildPaperTradingLedger(journalEntries, {
    userId,
    snapshotPriceBySymbol,
    asOfDate: format(new Date(), "yyyy-MM-dd"),
  });

  if (ledger.errors.length > 0) {
    throw new Error(ledger.errors[0]);
  }

  const tradingSchema = supabase.schema("trading");

  // Single atomic RPC (trading.rebuild_paper_trading_state, migration 0043)
  // replaces what used to be 3 parallel deletes + 2 sequential inserts as 5
  // independent Supabase REST calls. That was both non-transactional (a
  // network failure mid-sequence left the user's trading history empty) and
  // broken outright: trading.trades/portfolio_history had no DELETE RLS
  // policy, so the old deletes silently no-op'd and every rebuild after the
  // first one hit a duplicate-key/unique-violation error on reinsert.
  const { error } = await tradingSchema.rpc("rebuild_paper_trading_state", {
    p_user_id: userId,
    p_open_positions: ledger.openPositions.map((position) => ({
      id: position.id,
      symbol: position.symbol,
      name: position.name,
      quantity: position.quantity,
      entry_price: position.entry_price,
      current_price: position.current_price,
      type: position.type,
      entry_date: position.entry_date,
      created_at: position.created_at,
      updated_at: position.updated_at,
    })),
    p_trades: ledger.allTrades.map((trade) => ({
      id: trade.id,
      symbol: trade.symbol,
      type: trade.type,
      action: trade.action,
      quantity: trade.quantity,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      entry_date: trade.entry_date,
      exit_date: trade.exit_date,
      pnl: trade.pnl,
      created_at: trade.created_at,
      updated_at: trade.updated_at,
    })),
    p_portfolio_history: ledger.portfolioHistory.map((point) => ({
      date: point.date,
      value: point.value,
      created_at: point.created_at,
    })),
  });

  if (error) throw error;

  return ledger;
}
