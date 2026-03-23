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

  const [
    deletePositionsResult,
    deleteTradesResult,
    deleteHistoryResult,
  ] = await Promise.all([
    tradingSchema.from("open_positions").delete().eq("user_id", userId),
    tradingSchema.from("trades").delete().eq("user_id", userId),
    tradingSchema.from("portfolio_history").delete().eq("user_id", userId),
  ]);

  if (deletePositionsResult.error) throw deletePositionsResult.error;
  if (deleteTradesResult.error) throw deleteTradesResult.error;
  if (deleteHistoryResult.error) throw deleteHistoryResult.error;

  if (ledger.openPositions.length > 0) {
    const { error } = await tradingSchema
      .from("open_positions")
      .insert(ledger.openPositions.map((position) => ({
        id: position.id,
        user_id: position.user_id,
        symbol: position.symbol,
        name: position.name,
        quantity: position.quantity,
        entry_price: position.entry_price,
        current_price: position.current_price,
        type: position.type,
        entry_date: position.entry_date,
        created_at: position.created_at,
        updated_at: position.updated_at,
      })));

    if (error) throw error;
  }

  if (ledger.allTrades.length > 0) {
    const { error } = await tradingSchema
      .from("trades")
      .insert(ledger.allTrades.map((trade) => ({
        id: trade.id,
        user_id: trade.user_id,
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
      })));

    if (error) throw error;
  }

  if (ledger.portfolioHistory.length > 0) {
    const { error } = await tradingSchema
      .from("portfolio_history")
      .insert(ledger.portfolioHistory.map((point) => ({
        user_id: point.user_id,
        date: point.date,
        value: point.value,
        created_at: point.created_at,
      })));

    if (error) throw error;
  }

  return ledger;
}
