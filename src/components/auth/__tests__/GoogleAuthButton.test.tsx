import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleAuthButton } from '../GoogleAuthButton';

const mockSignInWithGoogle = vi.fn();
const mockToast = vi.fn();

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    signInWithGoogle: mockSignInWithGoogle,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: (props: unknown) => mockToast(props),
}));

describe('GoogleAuthButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithGoogle.mockResolvedValue(undefined);
  });

  it('renders Continue with Google by default', () => {
    render(<GoogleAuthButton />);
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
  });

  it('calls signInWithGoogle once on click', async () => {
    const user = userEvent.setup();
    render(<GoogleAuthButton returnTo="/onboarding" />);

    await user.click(screen.getByRole('button', { name: /continue with google/i }));

    await waitFor(() => {
      expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
      expect(mockSignInWithGoogle).toHaveBeenCalledWith('/onboarding');
    });
  });

  it('shows loading state and prevents double-click', async () => {
    let resolveOAuth: () => void;
    mockSignInWithGoogle.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveOAuth = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<GoogleAuthButton />);

    const button = screen.getByRole('button', { name: /continue with google/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/redirecting to google/i)).toBeInTheDocument();
    });

    expect(button).toBeDisabled();

    await user.click(button);
    expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);

    resolveOAuth!();
  });

  it('shows error toast on OAuth initialization failure', async () => {
    mockSignInWithGoogle.mockRejectedValue(new Error('OAuth failed'));
    const user = userEvent.setup();

    render(<GoogleAuthButton />);
    await user.click(screen.getByRole('button', { name: /continue with google/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Google sign-in failed',
          variant: 'destructive',
        }),
      );
    });
  });

  it('respects disabled prop', () => {
    render(<GoogleAuthButton disabled />);
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
  });
});
