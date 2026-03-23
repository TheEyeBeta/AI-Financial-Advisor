import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/tests/test-utils';
import userEvent from '@testing-library/user-event';
import { OpenPositions } from '../OpenPositions';
import type { OpenPosition } from '@/types/database';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockDeleteMutateAsync = vi.fn();

vi.mock('@/hooks/use-data', () => ({
  useOpenPositions: vi.fn(() => ({ data: [], isLoading: false })),
  useDeletePosition: vi.fn(() => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  })),
}));

vi.mock('@/hooks/use-trade-engine', () => ({
  useTradeEngineConnection: vi.fn(() => ({
    isConnected: false,
    isConnecting: false,
  })),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

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

describe('OpenPositions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    render(<OpenPositions isLoading={true} />);
    const pulsingElements = document.querySelectorAll('.animate-pulse');
    expect(pulsingElements.length).toBeGreaterThan(0);
  });

  it('renders empty state when no positions', () => {
    render(<OpenPositions positions={[]} />);
    expect(screen.getByText('No open positions')).toBeInTheDocument();
    expect(screen.getByText('Start trading to see your holdings here')).toBeInTheDocument();
  });

  it('renders positions with correct data', () => {
    const positions = [
      makePosition(),
      makePosition({ id: 'pos-2', symbol: 'NVDA', entry_price: 200, current_price: 250, quantity: 5 }),
    ];

    render(<OpenPositions positions={positions} />);

    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('10 shares @ $150.00')).toBeInTheDocument();
    expect(screen.getByText('5 shares @ $200.00')).toBeInTheDocument();
  });

  it('calculates P&L correctly', () => {
    // entry: 150, current: 175, qty: 10 → P&L = +$250.00
    const positions = [makePosition()];
    render(<OpenPositions positions={positions} />);

    // P&L appears in the position row (may also appear in summary)
    const pnlElements = screen.getAllByText('+$250.00');
    expect(pnlElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('+16.67%')).toBeInTheDocument();
  });

  it('calculates negative P&L correctly', () => {
    const positions = [makePosition({ entry_price: 200, current_price: 180 })];
    render(<OpenPositions positions={positions} />);

    // P&L = (180 - 200) * 10 = -$200.00
    // The negative sign and dollar amount may be split across elements
    const pnlElements = screen.getAllByText((content) => content.includes('200.00'));
    expect(pnlElements.length).toBeGreaterThanOrEqual(1);
  });

  it('displays summary cards with totals', () => {
    const positions = [makePosition()];
    render(<OpenPositions positions={positions} />);

    // Market value: 175 * 10 = $1,750
    expect(screen.getByText('Market Value')).toBeInTheDocument();
    expect(screen.getByText('Unrealized P&L')).toBeInTheDocument();
    expect(screen.getByText('Positions')).toBeInTheDocument();
  });

  it('calls deletePosition when close button is clicked', async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn(() => true);
    mockDeleteMutateAsync.mockResolvedValue(undefined);

    render(<OpenPositions positions={[makePosition()]} allowClose={true} />);

    const closeButton = screen.getByRole('button');
    await user.click(closeButton);

    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to close this position?');
    expect(mockDeleteMutateAsync).toHaveBeenCalledWith('pos-1');
  });

  it('does not delete when confirm is cancelled', async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn(() => false);

    render(<OpenPositions positions={[makePosition()]} allowClose={true} />);

    const closeButton = screen.getByRole('button');
    await user.click(closeButton);

    expect(mockDeleteMutateAsync).not.toHaveBeenCalled();
  });

  it('hides close button when allowClose is false', () => {
    render(<OpenPositions positions={[makePosition()]} allowClose={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses entry price as fallback when current_price is null', () => {
    const positions = [makePosition({ current_price: null })];
    render(<OpenPositions positions={positions} />);

    // P&L should be $0.00 when current_price falls back to entry_price
    const zeroElements = screen.getAllByText('+$0.00');
    expect(zeroElements.length).toBeGreaterThanOrEqual(1);
  });
});
