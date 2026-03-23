import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/tests/test-utils';
import userEvent from '@testing-library/user-event';
import { TradeJournal } from '../TradeJournal';
import type { OpenPosition, TradeJournalEntry } from '@/types/database';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockCreateMutateAsync = vi.fn();

vi.mock('@/hooks/use-data', () => ({
  useCreateJournalEntry: vi.fn(() => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  })),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn(() => ({
    userId: 'user-1',
  })),
}));

vi.mock('@/services/paper-trading-sync', () => ({
  rebuildPaperTradingState: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const makeJournalEntry = (overrides: Partial<TradeJournalEntry> = {}): TradeJournalEntry => ({
  id: 'journal-1',
  user_id: 'user-1',
  trade_id: null,
  symbol: 'AAPL',
  type: 'BUY',
  date: '2025-01-15',
  quantity: 10,
  price: 150,
  strategy: 'Momentum play on earnings beat',
  notes: 'Strong volume confirmation',
  tags: ['momentum', 'earnings'],
  created_at: '2025-01-15T00:00:00Z',
  updated_at: '2025-01-15T00:00:00Z',
  ...overrides,
});

const makePosition = (overrides: Partial<OpenPosition> = {}): OpenPosition => ({
  id: 'pos-1',
  user_id: 'user-1',
  symbol: 'AAPL',
  name: 'Apple Inc.',
  quantity: 10,
  entry_price: 150,
  current_price: 175,
  type: 'LONG',
  entry_date: '2025-01-15',
  created_at: '2025-01-15T00:00:00Z',
  updated_at: '2025-01-15T00:00:00Z',
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TradeJournal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  describe('journal mode', () => {
    it('renders empty state when no entries', () => {
      render(
        <TradeJournal
          mode="journal"
          journalEntries={[]}
          isJournalLoading={false}
          openPositions={[]}
        />,
      );

      expect(screen.getByText('No journal entries yet')).toBeInTheDocument();
      expect(screen.getByText(/Click "Log Trade" to document your first trade/)).toBeInTheDocument();
    });

    it('renders loading state', () => {
      render(
        <TradeJournal
          mode="journal"
          journalEntries={[]}
          isJournalLoading={true}
          openPositions={[]}
        />,
      );

      const pulsingElements = document.querySelectorAll('.animate-pulse');
      expect(pulsingElements.length).toBeGreaterThan(0);
    });

    it('renders journal entries with correct data', () => {
      const entries = [
        makeJournalEntry(),
        makeJournalEntry({
          id: 'journal-2',
          symbol: 'NVDA',
          type: 'SELL',
          price: 800,
          quantity: 5,
          tags: ['tech'],
        }),
      ];

      render(
        <TradeJournal
          mode="journal"
          journalEntries={entries}
          isJournalLoading={false}
          openPositions={[]}
        />,
      );

      expect(screen.getByText('AAPL')).toBeInTheDocument();
      expect(screen.getByText('NVDA')).toBeInTheDocument();
      expect(screen.getByText('momentum')).toBeInTheDocument();
      expect(screen.getByText('earnings')).toBeInTheDocument();
      expect(screen.getByText('tech')).toBeInTheDocument();
    });

    it('displays strategy and notes', () => {
      render(
        <TradeJournal
          mode="journal"
          journalEntries={[makeJournalEntry()]}
          isJournalLoading={false}
          openPositions={[]}
        />,
      );

      expect(screen.getByText('Momentum play on earnings beat')).toBeInTheDocument();
      expect(screen.getByText('Strong volume confirmation')).toBeInTheDocument();
    });

    it('shows entry count', () => {
      render(
        <TradeJournal
          mode="journal"
          journalEntries={[makeJournalEntry()]}
          isJournalLoading={false}
          openPositions={[]}
        />,
      );

      expect(screen.getByText('1 journal entry')).toBeInTheDocument();
    });

    it('toggles form visibility on button click', async () => {
      const user = userEvent.setup();

      render(
        <TradeJournal
          mode="journal"
          journalEntries={[]}
          isJournalLoading={false}
          openPositions={[]}
        />,
      );

      // Initially form is hidden
      expect(screen.queryByLabelText('Symbol')).not.toBeInTheDocument();

      // Click "Log Trade" to show form
      await user.click(screen.getByText('Log Trade'));
      expect(screen.getByLabelText('Symbol')).toBeInTheDocument();

      // Click the header "Cancel" button (the one that toggles form visibility)
      // It's the first Cancel button (the toggle), not the form-level one
      const cancelButtons = screen.getAllByText('Cancel');
      await user.click(cancelButtons[0]);
      expect(screen.queryByLabelText('Symbol')).not.toBeInTheDocument();
    });

    it('closes an open buy entry from the journal list', async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.fn(() => true);
      vi.stubGlobal('confirm', confirmSpy);

      mockCreateMutateAsync.mockResolvedValueOnce(
        makeJournalEntry({
          id: 'journal-close-1',
          type: 'SELL',
          price: 175,
        }),
      );

      render(
        <TradeJournal
          mode="journal"
          journalEntries={[makeJournalEntry()]}
          isJournalLoading={false}
          openPositions={[makePosition({ id: 'journal-1' })]}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Close' }));

      expect(confirmSpy).toHaveBeenCalledWith('Close the remaining 10 shares of AAPL at $175.00?');
      expect(mockCreateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        symbol: 'AAPL',
        type: 'SELL',
        quantity: 10,
        price: 175,
      }));
    });

    it('limits the journal list to five entries until show more is clicked', async () => {
      const user = userEvent.setup();
      const entries = ['ORCL', 'AAPL', 'NVDA', 'MSFT', 'AMD', 'TSLA'].map((symbol, index) =>
        makeJournalEntry({
          id: `journal-${index + 1}`,
          symbol,
          strategy: null,
          notes: null,
          tags: null,
        }),
      );

      render(
        <TradeJournal
          mode="journal"
          journalEntries={entries}
          isJournalLoading={false}
          openPositions={[]}
        />,
      );

      expect(screen.getByText('ORCL')).toBeInTheDocument();
      expect(screen.getByText('AMD')).toBeInTheDocument();
      expect(screen.queryByText('TSLA')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Show more (1 more)' }));

      expect(screen.getByText('TSLA')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    });
  });

  describe('workspace mode', () => {
    it('shows form by default', () => {
      render(
        <TradeJournal
          mode="workspace"
          journalEntries={[]}
          openPositions={[]}
        />,
      );

      expect(screen.getByLabelText('Symbol')).toBeInTheDocument();
      expect(screen.getByLabelText('Quantity')).toBeInTheDocument();
      expect(screen.getByLabelText('Price')).toBeInTheDocument();
      expect(screen.getByText('Reset')).toBeInTheDocument();
      expect(screen.queryByText('Log Trade')).not.toBeInTheDocument();
    });

    it('does not render journal entries list in workspace mode', () => {
      render(
        <TradeJournal
          mode="workspace"
          journalEntries={[makeJournalEntry()]}
          openPositions={[]}
        />,
      );

      // In workspace mode, entries are not rendered (only form is shown)
      expect(screen.queryByText('No journal entries yet')).not.toBeInTheDocument();
    });
  });
});
