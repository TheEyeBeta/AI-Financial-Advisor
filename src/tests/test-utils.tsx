import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';

// Mock auth context value type
export interface MockAuthContextValue {
  user: { id: string; email: string } | null;
  userProfile: { id: string; first_name: string; last_name: string } | null;
  loading: boolean;
  profileLoading: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  signIn: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  resetPassword: ReturnType<typeof vi.fn>;
  refreshProfile: ReturnType<typeof vi.fn>;
}

// Default mock auth context
export const createMockAuthContext = (overrides: Partial<MockAuthContextValue> = {}): MockAuthContextValue => ({
  user: null,
  userProfile: null,
  loading: false,
  profileLoading: false,
  isAuthenticated: false,
  userId: null,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  refreshProfile: vi.fn(),
  ...overrides,
});

// Mock Supabase client
export const createMockSupabase = () => ({
  auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
  },
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
});

// Wrapper component for testing
interface WrapperProps {
  children: React.ReactNode;
}

const AllTheProviders = ({ children }: WrapperProps) => {
  return (
    <BrowserRouter>
      {children}
    </BrowserRouter>
  );
};

// Custom render function
const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: AllTheProviders, ...options });

// Re-export everything
export * from '@testing-library/react';
export { customRender as render };
