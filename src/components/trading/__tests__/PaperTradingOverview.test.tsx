import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/tests/test-utils';
import { PaperTradingOverview } from '../PaperTradingOverview';
import type { OpenPosition, PortfolioHistory, Trade } from '@/types/database';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/hooks/use-trade-engine', () => ({
  useTradeEngineConnection: vi.fn(() => ({
    isConnected: false,
  })),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const makePosition = (overrides: Partial<OpenPosition> = {}): OpenPosition => ({
  id: 'pos-1',
  user_id: 'user-1',
  symbol: 'AAPL',
  name: 'Apple Inc.',
  quantity: 10,
  entry_price: 100,
  current_price: 120,
  type: 'LONG',
  entry_date: '2025-01-15',
  created_at: '2025-01-15T00:00:00Z',
  updated_at: '2025-01-15T00:00:00Z',
  ...overrides,
});

const makeTrade = (overrides: Partial<Trade> = {}): Trade => ({
  id: 'trade-1',
  user_id: 'user-1',
  symbol: 'MSFT',
  type: 'LONG',
  action: 'CLOSED',
  quantity: 5,
  entry_price: 300,
  exit_price: 350,
  entry_date: '2025-01-01',
  exit_date: '2025-01-20',
  pnl: 250,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-20T00:00:00Z',
  ...overrides,
});

const makeHistory = (date: string, value: number): PortfolioHistory => ({
  id: `ph-${date}`,
  user_id: 'user-1',
  date,
  value,
  created_at: `${date}T00:00:00Z`,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PaperTradingOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    render(
      <PaperTradingOverview
        positions={[]}
        trades={[]}
        portfolioHistory={[]}
        isLoading={true}
      />,
    );
    const pulsingElements = document.querySelectorAll('.animate-pulse');
    expect(pulsingElements.length).toBeGreaterThan(0);
  });

  it('renders all stat cards', () => {
    render(
      <PaperTradingOverview
        positions={[makePosition()]}
        trades={[makeTrade()]}
        portfolioHistory={[]}
      />,
    );

    expect(screen.getByText('Portfolio Value')).toBeInTheDocument();
    expect(screen.getByText('Total Return')).toBeInTheDocument();
    expect(screen.getByText('P&L Split')).toBeInTheDocument();
    expect(screen.getByText('Execution Score')).toBeInTheDocument();
  });

  it('calculates portfolio value correctly', () => {
    // Position: current_price 120 * qty 10 = 1200
    render(
      <PaperTradingOverview
        positions={[makePosition()]}
        trades={[]}
        portfolioHistory={[]}
      />,
    );

    expect(screen.getByText('$1,200.00')).toBeInTheDocument();
  });

  it('calculates win rate from closed trades', () => {
    const trades = [
      makeTrade({ pnl: 250 }),
      makeTrade({ id: 'trade-2', pnl: -100 }),
      makeTrade({ id: 'trade-3', pnl: 50 }),
    ];

    render(
      <PaperTradingOverview
        positions={[]}
        trades={trades}
        portfolioHistory={[]}
      />,
    );

    // 2 wins / 3 trades = 67%
    expect(screen.getByText('67% win rate')).toBeInTheDocument();
    expect(screen.getByText('3 closed trades recorded')).toBeInTheDocument();
  });

  it('shows open positions count when no closed trades', () => {
    render(
      <PaperTradingOverview
        positions={[makePosition(), makePosition({ id: 'pos-2' })]}
        trades={[]}
        portfolioHistory={[]}
      />,
    );

    expect(screen.getByText('2 open positions')).toBeInTheDocument();
    expect(screen.getByText('No completed trades yet')).toBeInTheDocument();
  });

  it('calculates P&L split correctly', () => {
    // Unrealized: (120 - 100) * 10 = $200
    // Realized: $250
    render(
      <PaperTradingOverview
        positions={[makePosition()]}
        trades={[makeTrade()]}
        portfolioHistory={[]}
      />,
    );

    // P&L Split shows "realized / unrealized"
    expect(screen.getByText('$250.00 / $200.00')).toBeInTheDocument();
    expect(screen.getByText('Realized / Unrealized')).toBeInTheDocument();
  });

  it('uses portfolio history for account value when available', () => {
    const history = [
      makeHistory('2025-01-01', 5000),
      makeHistory('2025-02-01', 6000),
    ];

    render(
      <PaperTradingOverview
        positions={[]}
        trades={[]}
        portfolioHistory={history}
      />,
    );

    // Account value = last history entry
    expect(screen.getByText('$6,000.00')).toBeInTheDocument();
  });
});
