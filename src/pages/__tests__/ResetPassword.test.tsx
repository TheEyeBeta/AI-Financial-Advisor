import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ResetPassword from '../ResetPassword';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockUpdateUser = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: (args: unknown) => mockUpdateUser(args),
    },
  },
}));

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (args: unknown) => mockToast(args),
}));

function renderReset(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/auth/reset-password" element={<ResetPassword />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUser.mockResolvedValue({ error: null });
  });

  it('redirects home when the link has no recovery params at all', async () => {
    renderReset('/auth/reset-password');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
  });

  it('accepts a PKCE-style ?code= recovery link (does not redirect away)', async () => {
    renderReset('/auth/reset-password?code=abc123');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
  });

  it('rejects a password shorter than 10 characters, matching the displayed requirement', async () => {
    const { container } = renderReset('/auth/reset-password?code=abc123');
    // Native minLength/required would block a real click before our JS
    // check runs; submit the form directly to exercise the JS-level guard
    // (defense in depth against non-conforming browsers/inputs).
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'short123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'short123' } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringContaining('10 characters') }),
      ),
    );
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords', async () => {
    const { container } = renderReset('/auth/reset-password?code=abc123');
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'longenoughpassword1' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'longenoughpassword2' } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Passwords do not match' }),
      ),
    );
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('accepts a valid matching password and updates the user', async () => {
    renderReset('/auth/reset-password?code=abc123');
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'longenoughpassword' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'longenoughpassword' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Password/ }));

    await waitFor(() =>
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'longenoughpassword' }),
    );
  });
});
