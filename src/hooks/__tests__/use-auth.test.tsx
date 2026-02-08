import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/hooks/use-auth";

const mockFns = vi.hoisted(() => ({
  mockSignInWithPassword: vi.fn(),
  mockSignUp: vi.fn(),
  mockSignOut: vi.fn(),
  mockResetPasswordForEmail: vi.fn(),
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockGetCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: mockFns.mockSignInWithPassword,
      signUp: mockFns.mockSignUp,
      signOut: mockFns.mockSignOut,
      resetPasswordForEmail: mockFns.mockResetPasswordForEmail,
      getSession: mockFns.mockGetSession,
      onAuthStateChange: mockFns.mockOnAuthStateChange,
    },
  },
}));

vi.mock("@/lib/user-helpers", () => ({
  getCurrentUserProfile: mockFns.mockGetCurrentUserProfile,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe("useAuth", () => {
  beforeEach(() => {
    mockFns.mockGetSession.mockResolvedValue({ data: { session: null } });
    mockFns.mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockFns.mockSignInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFns.mockSignUp.mockResolvedValue({ data: {}, error: null });
    mockFns.mockSignOut.mockResolvedValue({ error: null });
    mockFns.mockResetPasswordForEmail.mockResolvedValue({ error: null });
    mockFns.mockGetCurrentUserProfile.mockResolvedValue(null);
  });

  it("throws when used without AuthProvider", () => {
    expect(() => renderHook(() => useAuth())).toThrow("useAuthContext must be used within an AuthProvider");
  });

  it("initializes with no user and finishes loading", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
  });

  it("calls Supabase signIn with provided credentials", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.signIn("test@example.com", "password123");

    expect(mockFns.mockSignInWithPassword).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "password123",
    });
  });
});
