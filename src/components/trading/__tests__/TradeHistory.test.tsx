import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/tests/test-utils';
import { TradeHistory } from '../TradeHistory';
import type { Trade } from '@/types/database';

vi.mock('@/hooks/use-data', () => ({
  useClosedTrades: vi.fn(() => ({ data: [], isLoading: false })),
}));

const makeTrade = (overrides: Partial<Trade> = {}): Trade => ({
  id: 'trade-1',
  user_id: 'user-1',
  symbol: 'AAPL',
  type: 'LONG',
  action: 'CLOSED',
  quantity: 10,
  entry_price: 150,
  exit_price: 175,
  entry_date: '2025-01-15',
  exit_date: '2025-02-01',
  pnl: 250,
  created_at: '2025-01-15T00:00:00Z',
  updated_at: '2025-02-01T00:00:00Z',
  ...overrides,
});

describe('TradeHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    render(<TradeHistory isLoading={true} />);
    const pulsingElements = document.querySelectorAll('.animate-pulse');
    expect(pulsingElements.length).toBeGreaterThan(0);
  });

  it('renders empty state when no trades', () => {
    render(<TradeHistory trades={[]} />);
    expect(screen.getByText('No trade history')).toBeInTheDocument();
    expect(screen.getByText('Closed trades will appear here')).toBeInTheDocument();
  });

  it('renders trade rows with correct data', () => {
    const trades = [
      makeTrade(),
      makeTrade({ id: 'trade-2', symbol: 'NVDA', entry_price: 200, exit_price: 180, pnl: -200 }),
    ];

    render(<TradeHistory trades={trades} />);

    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
  });

  it('formats currency correctly', () => {
    render(<TradeHistory trades={[makeTrade()]} />);

    const pnlElements = screen.getAllByText('+$250.00');
    expect(pnlElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('10 @ $150.00 -> $175.00')).toBeInTheDocument();
  });

  it('formats dates with year correctly', () => {
    render(<TradeHistory trades={[makeTrade()]} />);

    expect(screen.getByText('Jan 15, 2025 -> Feb 1, 2025')).toBeInTheDocument();
  });

  it('shows win/loss summary counts', () => {
    const trades = [
      makeTrade({ pnl: 250 }),
      makeTrade({ id: 'trade-2', pnl: -100 }),
      makeTrade({ id: 'trade-3', pnl: 50 }),
    ];

    render(<TradeHistory trades={trades} />);

    expect(screen.getByText(/3 closed trades/)).toBeInTheDocument();
    expect(screen.getByText(/2 wins/)).toBeInTheDocument();
    expect(screen.getByText(/1 losses/)).toBeInTheDocument();
  });

  it('shows total realized P&L', () => {
    const trades = [
      makeTrade({ pnl: 250 }),
      makeTrade({ id: 'trade-2', pnl: -100 }),
    ];

    render(<TradeHistory trades={trades} />);

    expect(screen.getByText('Total Realized P&L')).toBeInTheDocument();
    expect(screen.getByText('+$150.00')).toBeInTheDocument();
  });

  it('handles losing trade with negative P&L', () => {
    render(<TradeHistory trades={[makeTrade({ pnl: -500 })]} />);

    const pnlElements = screen.getAllByText((content, element) => {
      return element?.textContent?.includes('-500.00') === true && element?.tagName === 'DIV';
    });
    expect(pnlElements.length).toBeGreaterThanOrEqual(1);
  });

  it('displays filter and export buttons', () => {
    render(<TradeHistory trades={[makeTrade()]} />);

    expect(screen.getByText('Filter')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('shows duration in days', () => {
    render(<TradeHistory trades={[makeTrade()]} />);

    expect(screen.getByText('17d')).toBeInTheDocument();
  });

  it('limits the list to the five most recent trades in descending order', () => {
    const trades = [
      makeTrade({ id: 'trade-1', symbol: 'AAA', exit_date: '2025-01-01', pnl: 10 }),
      makeTrade({ id: 'trade-2', symbol: 'BBB', exit_date: '2025-01-02', pnl: 20 }),
      makeTrade({ id: 'trade-3', symbol: 'CCC', exit_date: '2025-01-03', pnl: 30 }),
      makeTrade({ id: 'trade-4', symbol: 'DDD', exit_date: '2025-01-04', pnl: 40 }),
      makeTrade({ id: 'trade-5', symbol: 'EEE', exit_date: '2025-01-05', pnl: 50 }),
      makeTrade({ id: 'trade-6', symbol: 'FFF', exit_date: '2025-01-06', pnl: 60 }),
    ];

    render(<TradeHistory trades={trades} />);

    const symbols = screen.getAllByText(/AAA|BBB|CCC|DDD|EEE|FFF/).map((element) => element.textContent);
    expect(symbols).toEqual(['FFF', 'EEE', 'DDD', 'CCC', 'BBB']);
    expect(screen.queryByText('AAA')).not.toBeInTheDocument();
    expect(screen.getByText(/5 closed trades/)).toBeInTheDocument();
  });
});
