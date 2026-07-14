import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rebuildPaperTradingState } from '../paper-trading-sync';
import type { TradeJournalEntry } from '@/types/database';

const deleteMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
const insertMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase', () => ({
  supabase: {
    schema: () => ({
      from: () => ({
        delete: deleteMock,
        insert: insertMock,
      }),
    }),
  },
}));

vi.mock('@/services/stock-snapshots-api', () => ({
  stockSnapshotsApi: {
    getByTickers: vi.fn().mockResolvedValue([]),
  },
}));

function makeEntry(overrides: Partial<TradeJournalEntry>): TradeJournalEntry {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    user_id: overrides.user_id ?? 'user-123',
    trade_id: overrides.trade_id ?? null,
    symbol: overrides.symbol ?? 'NVDA',
    type: overrides.type ?? 'BUY',
    date: overrides.date ?? '2026-03-20',
    quantity: overrides.quantity ?? 1,
    price: overrides.price ?? 100,
    strategy: overrides.strategy ?? null,
    notes: overrides.notes ?? null,
    tags: overrides.tags ?? null,
    created_at: overrides.created_at ?? '2026-03-20T10:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-03-20T10:00:00.000Z',
  };
}

describe('rebuildPaperTradingState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteMock.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    insertMock.mockResolvedValue({ error: null });
  });

  it('does not throw on a normal BUY — regression test for the always-throws bug', async () => {
    // Every real user's ledger starts at $0 cash, so any BUY previously
    // triggered an "Auto-funded" entry in `ledger.errors`, which this
    // function treated as fatal and threw on — meaning every single trade
    // creation failed after the journal entry was already saved.
    const entry = makeEntry({ symbol: 'NVDA', type: 'BUY', quantity: 10, price: 50 });

    await expect(rebuildPaperTradingState('user-123', [entry])).resolves.toBeDefined();
    expect(insertMock).toHaveBeenCalled();
  });

  it('still persists positions/trades/history after a normal buy', async () => {
    const entry = makeEntry({ symbol: 'NVDA', type: 'BUY', quantity: 10, price: 50 });
    const ledger = await rebuildPaperTradingState('user-123', [entry]);

    expect(ledger.openPositions).toHaveLength(1);
    expect(ledger.errors).toEqual([]);
    expect(ledger.warnings.length).toBeGreaterThan(0);
    // Called once each for open_positions, trades, portfolio_history.
    expect(insertMock).toHaveBeenCalledTimes(3);
  });

  it('still throws for a genuinely invalid entry (fatal error, not a warning)', async () => {
    const entry = makeEntry({ symbol: 'NVDA', type: 'BUY', quantity: 0, price: 50 });

    await expect(rebuildPaperTradingState('user-123', [entry])).rejects.toThrow(
      /invalid/i,
    );
    expect(insertMock).not.toHaveBeenCalled();
  });
});
