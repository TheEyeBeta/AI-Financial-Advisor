import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignUpDialog } from '../SignUpDialog';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

const mockToast = vi.fn();
const mockSignUp = vi.fn();
const mockIsGoogleAuthEnabled = vi.fn(() => false);

vi.mock('@/lib/env', () => ({
  isGoogleAuthEnabled: () => mockIsGoogleAuthEnabled(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    signInWithGoogle: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: (props: unknown) => mockToast(props),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: (params: unknown) => mockSignUp(params),
    },
  },
}));

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('SignUpDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGoogleAuthEnabled.mockReturnValue(false);
    mockSignUp.mockResolvedValue({
      data: {
        user: { id: 'new-user', identities: [{ id: 'identity-1' }] },
      },
      error: null,
    });
  });

  it('renders signup form without age field', () => {
    renderWithProviders(<SignUpDialog {...defaultProps} />);

    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/age/i)).not.toBeInTheDocument();
  });

  it('shows Lens branding in description', () => {
    renderWithProviders(<SignUpDialog {...defaultProps} />);
    expect(screen.getByText(/build your financial profile/i)).toBeInTheDocument();
  });

  it('submits signup without age in metadata', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignUpDialog {...defaultProps} />);

    await user.type(screen.getByLabelText(/first name/i), 'Jane');
    await user.type(screen.getByLabelText(/last name/i), 'Doe');
    await user.type(screen.getByLabelText(/^email$/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password1234');
    await user.type(screen.getByLabelText(/confirm password/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'jane@example.com',
          password: 'password1234',
          options: expect.objectContaining({
            data: {
              first_name: 'Jane',
              last_name: 'Doe',
            },
          }),
        }),
      );
    });

    const callArgs = mockSignUp.mock.calls[0][0] as { options: { data: Record<string, unknown> } };
    expect(callArgs.options.data).not.toHaveProperty('age');
  });

  it('shows Google button when feature flag is enabled', () => {
    mockIsGoogleAuthEnabled.mockReturnValue(true);
    renderWithProviders(<SignUpDialog {...defaultProps} />);

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByText(/or continue with email/i)).toBeInTheDocument();
  });
});
