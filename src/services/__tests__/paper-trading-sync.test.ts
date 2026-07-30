import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rebuildPaperTradingState } from '../paper-trading-sync';
import type { TradeJournalEntry } from '@/types/database';

const rpcMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase', () => ({
  supabase: {
    schema: () => ({
      rpc: rpcMock,
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
    rpcMock.mockResolvedValue({ error: null });
  });

  it('does not throw on a normal BUY — regression test for the always-throws bug', async () => {
    // Every real user's ledger starts at $0 cash, so any BUY previously
    // triggered an "Auto-funded" entry in `ledger.errors`, which this
    // function treated as fatal and threw on — meaning every single trade
    // creation failed after the journal entry was already saved.
    const entry = makeEntry({ symbol: 'NVDA', type: 'BUY', quantity: 10, price: 50 });

    await expect(rebuildPaperTradingState('user-123', [entry])).resolves.toBeDefined();
    expect(rpcMock).toHaveBeenCalled();
  });

  it('persists positions/trades/history via a single atomic RPC call', async () => {
    const entry = makeEntry({ symbol: 'NVDA', type: 'BUY', quantity: 10, price: 50 });
    const ledger = await rebuildPaperTradingState('user-123', [entry]);

    expect(ledger.openPositions).toHaveLength(1);
    expect(ledger.errors).toEqual([]);
    expect(ledger.warnings.length).toBeGreaterThan(0);
    // The whole rebuild is one atomic RPC call now (migration 0043), not 5
    // separate delete/insert calls — this is the behavior under test.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      'rebuild_paper_trading_state',
      expect.objectContaining({
        p_user_id: 'user-123',
        p_open_positions: expect.arrayContaining([
          expect.objectContaining({ symbol: 'NVDA' }),
        ]),
      }),
    );
  });

  it('still throws for a genuinely invalid entry (fatal error, not a warning)', async () => {
    const entry = makeEntry({ symbol: 'NVDA', type: 'BUY', quantity: 0, price: 50 });

    await expect(rebuildPaperTradingState('user-123', [entry])).rejects.toThrow(
      /invalid/i,
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
