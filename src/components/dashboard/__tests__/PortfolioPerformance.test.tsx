import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/tests/test-utils';
import { PortfolioPerformance } from '../PortfolioPerformance';
import type { OpenPosition, PortfolioHistory } from '@/types/database';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('@/hooks/use-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-data')>();
  return {
    ...actual,
    usePortfolioHistory: vi.fn(() => ({ data: [], isLoading: false })),
    useOpenPositions: vi.fn(() => ({ data: [], isLoading: false })),
    useTrades: vi.fn(() => ({ data: [], isLoading: false })),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Mock recharts to avoid rendering complexities in tests
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart-container">{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  Cell: () => null,
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const makeHistory = (date: string, value: number): PortfolioHistory => ({
  id: `ph-${date}`,
  user_id: 'user-1',
  date,
  value,
  created_at: `${date}T00:00:00Z`,
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

describe('PortfolioPerformance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    render(<PortfolioPerformance isLoading={true} />);
    const pulsingElements = document.querySelectorAll('.animate-pulse');
    expect(pulsingElements.length).toBeGreaterThan(0);
  });

  it('renders empty state when no data', () => {
    render(<PortfolioPerformance portfolioHistory={[]} openPositions={[]} />);
    expect(screen.getByText('No portfolio history yet')).toBeInTheDocument();
    expect(screen.getByText('Start Trading')).toBeInTheDocument();
  });

  it('navigates to paper-trading on Start Trading click', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();

    render(<PortfolioPerformance portfolioHistory={[]} openPositions={[]} />);

    await user.click(screen.getByText('Start Trading'));
    expect(mockNavigate).toHaveBeenCalledWith('/paper-trading');
  });

  it('renders chart when portfolio history exists', () => {
    const history = [
      makeHistory('2025-01-01', 10000),
      makeHistory('2025-02-01', 11000),
      makeHistory('2025-03-01', 12000),
    ];

    render(<PortfolioPerformance portfolioHistory={history} openPositions={[]} />);

    expect(screen.getByText('Portfolio Performance')).toBeInTheDocument();
  });

  it('calculates positive return correctly', () => {
    const history = [
      makeHistory('2025-01-01', 10000),
      makeHistory('2025-03-01', 12000),
    ];

    render(<PortfolioPerformance portfolioHistory={history} openPositions={[]} />);

    expect(screen.getByText('$12,000')).toBeInTheDocument();
    expect(screen.getByText(/\+\$2,000.00 all time/)).toBeInTheDocument();
    expect(screen.getByText('+20.00%')).toBeInTheDocument();
  });

  it('calculates negative return correctly', () => {
    const history = [
      makeHistory('2025-01-01', 10000),
      makeHistory('2025-03-01', 8000),
    ];

    render(<PortfolioPerformance portfolioHistory={history} openPositions={[]} />);

    expect(screen.getByText('$8,000')).toBeInTheDocument();
    expect(screen.getByText('-20.00%')).toBeInTheDocument();
  });

  it('uses open positions as fallback when no history', () => {
    const positions = [makePosition()];

    render(<PortfolioPerformance portfolioHistory={[]} openPositions={positions} />);

    // Position value: 175 * 10 = 1,750
    expect(screen.getByText('$1,750')).toBeInTheDocument();
  });
});
