import { describe, expect, it } from "vitest";
import { buildPaperTradingLedger } from "@/lib/paper-trading-ledger";
import type { TradeJournalEntry } from "@/types/database";

function makeEntry(overrides: Partial<TradeJournalEntry>): TradeJournalEntry {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    user_id: overrides.user_id ?? "user-123",
    trade_id: overrides.trade_id ?? null,
    symbol: overrides.symbol ?? "NVDA",
    type: overrides.type ?? "BUY",
    date: overrides.date ?? "2026-03-20",
    quantity: overrides.quantity ?? 1,
    price: overrides.price ?? 100,
    strategy: overrides.strategy ?? null,
    notes: overrides.notes ?? null,
    tags: overrides.tags ?? null,
    created_at: overrides.created_at ?? "2026-03-20T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-20T10:00:00.000Z",
  };
}

describe("buildPaperTradingLedger", () => {
  it("replays a backdated buy using the journal entry price as cost basis", () => {
    const ledger = buildPaperTradingLedger(
      [
        makeEntry({
          id: "buy-2023",
          symbol: "NVDA",
          type: "BUY",
          date: "2023-08-18",
          quantity: 100,
          price: 10,
          created_at: "2026-03-20T12:00:00.000Z",
        }),
      ],
      {
        userId: "user-123",
        snapshotPriceBySymbol: new Map([["NVDA", 175.71]]),
        asOfDate: "2026-03-20",
      },
    );

    expect(ledger.openPositions).toHaveLength(1);
    expect(ledger.openPositions[0].entry_price).toBe(10);
    expect(ledger.openPositions[0].current_price).toBe(175.71);
    expect(ledger.marketValue).toBe(17571);
    expect(ledger.unrealizedPnl).toBe(16571);
    expect(ledger.realizedPnl).toBe(0);
    expect(ledger.totalPnl).toBe(16571);
    expect(ledger.investedCapital).toBe(1000);
    expect(ledger.totalReturnPct).toBeCloseTo(1657.1, 5);
  });

  it("matches sells FIFO after sorting the journal chronologically", () => {
    const entries: TradeJournalEntry[] = [
      makeEntry({
        id: "sell-late-array",
        symbol: "AAPL",
        type: "SELL",
        date: "2024-03-01",
        quantity: 15,
        price: 150,
        created_at: "2026-03-20T15:00:00.000Z",
      }),
      makeEntry({
        id: "buy-feb",
        symbol: "AAPL",
        type: "BUY",
        date: "2024-02-01",
        quantity: 10,
        price: 120,
        created_at: "2026-03-20T14:00:00.000Z",
      }),
      makeEntry({
        id: "buy-jan",
        symbol: "AAPL",
        type: "BUY",
        date: "2024-01-10",
        quantity: 10,
        price: 100,
        created_at: "2026-03-20T13:00:00.000Z",
      }),
    ];

    const ledger = buildPaperTradingLedger(entries, {
      userId: "user-123",
      snapshotPriceBySymbol: new Map([["AAPL", 200]]),
      asOfDate: "2026-03-20",
    });

    expect(ledger.errors).toEqual([]);
    expect(ledger.closedTrades).toHaveLength(1);
    expect(ledger.closedTrades[0].quantity).toBe(15);
    expect(ledger.closedTrades[0].entry_price).toBeCloseTo(106.6666667, 5);
    expect(ledger.closedTrades[0].pnl).toBeCloseTo(650, 5);
    expect(ledger.openPositions).toHaveLength(1);
    expect(ledger.openPositions[0].quantity).toBe(5);
    expect(ledger.openPositions[0].entry_price).toBe(120);
    expect(ledger.realizedPnl).toBe(650);
    expect(ledger.unrealizedPnl).toBe(400);
    expect(ledger.totalPnl).toBe(1050);
    expect(ledger.accountValue).toBe(3250);
  });
});
