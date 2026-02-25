import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ProtectedRoute } from '../ProtectedRoute';

// Mock the useAuth hook
const mockUseAuth = vi.fn();
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

// Mock useLocation
const mockLocation = { pathname: '/dashboard', state: null };
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useLocation: () => mockLocation,
  };
});

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when auth is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
      userProfile: null,
      profileLoading: false,
    });

    render(
      <BrowserRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </BrowserRouter>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects to landing page when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
      userProfile: null,
      profileLoading: false,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    // Should redirect to landing page
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '123', email: 'test@example.com' },
      loading: false,
      isAuthenticated: true,
      userProfile: { onboarding_complete: true },
      profileLoading: false,
    });

    render(
      <BrowserRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </BrowserRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects to onboarding when user has not completed onboarding', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '123', email: 'test@example.com' },
      loading: false,
      isAuthenticated: true,
      userProfile: { onboarding_complete: false, userType: 'User' },
      profileLoading: false,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('allows admin to skip onboarding', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '123', email: 'admin@example.com' },
      loading: false,
      isAuthenticated: true,
      userProfile: { onboarding_complete: false, userType: 'Admin' },
      profileLoading: false,
    });

    render(
      <BrowserRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </BrowserRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('shows loading when profile is loading', () => {
    mockUseAuth.mockReturnValue({
      user: { id: '123', email: 'test@example.com' },
      loading: false,
      isAuthenticated: true,
      userProfile: null,
      profileLoading: true,
    });

    render(
      <BrowserRouter>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </BrowserRouter>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
