import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from '../Onboarding';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/services/academy-api', () => ({
  academyApi: { upsertProfile: vi.fn(), enrollInTier: vi.fn() },
  TIER_IDS: { BEGINNER: 'beginner' },
}));
vi.mock('@/services/analytics', () => ({
  AnalyticsEvents: { onboardingComplete: vi.fn() },
}));
vi.mock('@/services/iris-cache', () => ({ refreshIrisContextCache: vi.fn() }));

let mockProfileRow: Record<string, unknown> | null = null;
const upsertSpy = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase', () => ({
  coreDb: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mockProfileRow }),
        }),
      }),
      upsert: (payload: unknown) => upsertSpy(payload),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
  meridianDb: {
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  },
}));

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <Onboarding />
    </MemoryRouter>,
  );
}

describe('Onboarding — progress persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileRow = null;
    mockUseAuth.mockReturnValue({
      authUserId: 'auth-user-1',
      appUserId: 'app-user-1',
      userProfile: { first_name: 'Jane', last_name: 'Doe' },
      refreshProfile: vi.fn(),
      onboardingComplete: false,
    });
  });

  it('starts fresh at step 1 with no existing profile', async () => {
    renderOnboarding();
    await waitFor(() => expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument());
  });

  it('resumes at step 3 when steps 1-2 were already saved (refresh does not destroy progress)', async () => {
    mockProfileRow = {
      age_range: '25-34',
      income_range: '50-80k',
      dependants: 0,
      monthly_expenses: 1500,
      total_debt: 2000,
      emergency_fund_months: 3,
      monthly_investable: 400,
      risk_profile: null,
      investment_horizon: null,
    };
    renderOnboarding();
    await waitFor(() => expect(screen.getByText(/Step 3 of 5/)).toBeInTheDocument());
  });

  it('resumes at step 5 once risk profile and horizon are already saved', async () => {
    mockProfileRow = {
      age_range: '25-34',
      income_range: '50-80k',
      dependants: 0,
      monthly_expenses: 1500,
      total_debt: 2000,
      emergency_fund_months: 3,
      monthly_investable: 400,
      risk_profile: 'moderate',
      investment_horizon: 'balanced',
    };
    renderOnboarding();
    await waitFor(() => expect(screen.getByText(/Step 5 of 5/)).toBeInTheDocument());
  });

  it('persists step 4 (investment horizon) to the backend before advancing', async () => {
    mockProfileRow = {
      age_range: '25-34',
      income_range: '50-80k',
      dependants: 0,
      monthly_expenses: 1500,
      total_debt: 2000,
      emergency_fund_months: 3,
      monthly_investable: 400,
      risk_profile: 'moderate',
      investment_horizon: null,
    };
    renderOnboarding();
    await waitFor(() => expect(screen.getByText(/Step 4 of 5/)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/Balanced/));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() =>
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'auth-user-1', investment_horizon: 'balanced' }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/Step 5 of 5/)).toBeInTheDocument());
  });
});
