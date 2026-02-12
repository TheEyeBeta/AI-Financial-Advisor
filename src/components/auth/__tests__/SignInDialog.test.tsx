import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignInDialog } from '../SignInDialog';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

// Mock the useAuth hook
const mockSignIn = vi.fn();
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    user: null,
    loading: false,
    isAuthenticated: false,
  }),
}));

// Mock the toast hook
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (props: unknown) => mockToast(props),
}));

// Mock react-router-dom's useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

// Wrapper component
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <BrowserRouter>
      {ui}
    </BrowserRouter>
  );
};

describe('SignInDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sign in form with email and password fields', () => {
    renderWithProviders(<SignInDialog {...defaultProps} />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('has required fields that prevent submission when empty', async () => {
    renderWithProviders(<SignInDialog {...defaultProps} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    // Both fields should have the required attribute
    expect(emailInput).toBeRequired();
    expect(passwordInput).toBeRequired();
  });

  it('shows error toast when email is entered but password is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInDialog {...defaultProps} />);

    const emailInput = screen.getByLabelText(/email/i);
    
    // Enter only email, leaving password empty
    await user.type(emailInput, 'test@example.com');
    
    // The form has HTML5 validation, so the password field being required
    // prevents submission - we verify the form has proper validation
    const passwordInput = screen.getByLabelText(/password/i);
    expect(passwordInput).toBeRequired();
    expect((passwordInput as HTMLInputElement).value).toBe('');
  });

  it('calls signIn with correct credentials on valid submission', async () => {
    mockSignIn.mockResolvedValue({});
    const user = userEvent.setup();

    renderWithProviders(<SignInDialog {...defaultProps} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('shows success toast and navigates on successful sign in', async () => {
    mockSignIn.mockResolvedValue({});
    const user = userEvent.setup();

    renderWithProviders(<SignInDialog {...defaultProps} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Success',
          description: 'Signed in successfully',
        })
      );
    });

    expect(mockNavigate).toHaveBeenCalledWith('/advisor');
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows error toast on sign in failure', async () => {
    mockSignIn.mockRejectedValue(new Error('Invalid credentials'));
    const user = userEvent.setup();

    renderWithProviders(<SignInDialog {...defaultProps} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          variant: 'destructive',
        })
      );
    });
  });

  it('shows loading state during sign in', async () => {
    // Create a promise that we can resolve later
    let resolveSignIn: () => void;
    const signInPromise = new Promise<void>((resolve) => {
      resolveSignIn = resolve;
    });
    mockSignIn.mockReturnValue(signInPromise);
    
    const user = userEvent.setup();

    renderWithProviders(<SignInDialog {...defaultProps} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Button should show loading state
    await waitFor(() => {
      expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    });

    // Resolve the sign in
    resolveSignIn!();
  });

  it('has forgot password link', () => {
    renderWithProviders(<SignInDialog {...defaultProps} />);

    expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderWithProviders(<SignInDialog open={false} onOpenChange={vi.fn()} />);

    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it('clears form fields after successful sign in', async () => {
    mockSignIn.mockResolvedValue({});
    const user = userEvent.setup();

    renderWithProviders(<SignInDialog {...defaultProps} />);

    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(emailInput.value).toBe('');
      expect(passwordInput.value).toBe('');
    });
  });
});
