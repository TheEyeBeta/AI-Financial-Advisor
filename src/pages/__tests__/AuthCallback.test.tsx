import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthCallback from '../AuthCallback';

const mockNavigate = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

const mockUseAuth = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
    },
  },
}));

function renderCallback(initialPath = '/auth/callback?code=abc&next=%2Fadvisor') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });

    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    mockUseAuth.mockReturnValue({
      userProfile: { userType: 'User', onboarding_complete: true },
      profileLoading: false,
      onboardingComplete: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes completed user to intended destination', async () => {
    renderCallback('/auth/callback?code=abc&next=%2Fprofile');

    await vi.advanceTimersByTimeAsync(1100);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/profile', { replace: true });
    });
  });

  it('routes incomplete user to onboarding', async () => {
    mockUseAuth.mockReturnValue({
      userProfile: { userType: 'User', onboarding_complete: false },
      profileLoading: false,
      onboardingComplete: false,
    });

    renderCallback();

    await vi.advanceTimersByTimeAsync(1100);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true });
    });
  });

  it('routes admin to admin dashboard', async () => {
    mockUseAuth.mockReturnValue({
      userProfile: { userType: 'Admin', onboarding_complete: false },
      profileLoading: false,
      onboardingComplete: false,
    });

    renderCallback();

    await vi.advanceTimersByTimeAsync(1100);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/admin', { replace: true });
    });
  });

  it('shows recoverable message on OAuth cancellation', async () => {
    renderCallback('/auth/callback?error=access_denied');

    expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /return home/i })).toBeInTheDocument();
  });

  it('shows recoverable message on missing session timeout', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    renderCallback();

    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(10000);

    await waitFor(() => {
      expect(screen.getByText(/timed out|not completed/i)).toBeInTheDocument();
    });
  });
});
