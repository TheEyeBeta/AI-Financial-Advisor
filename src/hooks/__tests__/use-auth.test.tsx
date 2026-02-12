import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';

// Mock implementations - these must be defined before the import
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockSignOut = vi.fn();
const mockResetPasswordForEmail = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
      signInWithPassword: (params: unknown) => mockSignInWithPassword(params),
      signUp: (params: unknown) => mockSignUp(params),
      signOut: () => mockSignOut(),
      resetPasswordForEmail: (email: string, opts: unknown) => mockResetPasswordForEmail(email, opts),
    },
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
  },
  getCurrentUserId: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/user-helpers', () => ({
  getCurrentUserProfile: vi.fn().mockResolvedValue(null),
}));

// Import after mocks are set up
import { AuthProvider, useAuthContext } from '@/context/AuthContext';

// Wrapper component for testing hooks that need AuthProvider
const createWrapper = () => {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <BrowserRouter>
        <AuthProvider>{children}</AuthProvider>
      </BrowserRouter>
    );
  };
};

describe('useAuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  it('should initialize with no user and loading true', async () => {
    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(),
    });

    // Initially loading should be true
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);

    // Wait for initial session check to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should set user when session exists', async () => {
    const mockUser = {
      id: 'auth-user-123',
      email: 'test@example.com',
    };

    mockGetSession.mockResolvedValue({
      data: { session: { user: mockUser } },
      error: null,
    });

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should handle sign in successfully', async () => {
    const mockUser = {
      id: 'auth-user-123',
      email: 'test@example.com',
    };

    mockSignInWithPassword.mockResolvedValue({
      data: { user: mockUser, session: { user: mockUser } },
      error: null,
    });

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signIn('test@example.com', 'password123');
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });
  });

  it('should throw error on sign in failure', async () => {
    const mockError = new Error('Invalid credentials');
    
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: mockError,
    });

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.signIn('test@example.com', 'wrong-password');
      })
    ).rejects.toThrow('Invalid credentials');
  });

  it('should handle sign up successfully', async () => {
    const mockUser = {
      id: 'new-user-123',
      email: 'new@example.com',
    };

    mockSignUp.mockResolvedValue({
      data: { user: mockUser, session: null },
      error: null,
    });

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signUp('new@example.com', 'newpassword123');
    });

    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'newpassword123',
    });
  });

  it('should handle sign out successfully', async () => {
    mockSignOut.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockSignOut).toHaveBeenCalled();
  });

  it('should handle password reset', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuthContext(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.resetPassword('test@example.com');
    });

    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      'test@example.com',
      expect.objectContaining({
        redirectTo: expect.stringContaining('/auth/reset-password'),
      })
    );
  });

  it('should throw error if used outside AuthProvider', () => {
    // Suppress console.error for this test since React will log an error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      renderHook(() => useAuthContext());
    }).toThrow('useAuthContext must be used within an AuthProvider');
    
    consoleSpy.mockRestore();
  });
});
