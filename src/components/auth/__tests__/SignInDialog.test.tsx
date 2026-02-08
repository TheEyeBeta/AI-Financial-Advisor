import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SignInDialog } from "@/components/auth/SignInDialog";

const mockFns = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockNavigate: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    signIn: mockFns.mockSignIn,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockFns.mockNavigate,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockFns.mockToast,
}));

describe("SignInDialog", () => {
  beforeEach(() => {
    mockFns.mockSignIn.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("renders login form fields and submit button", () => {
    render(<SignInDialog open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("submits the form with valid credentials", async () => {
    const onOpenChange = vi.fn();
    render(<SignInDialog open={true} onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockFns.mockSignIn).toHaveBeenCalledWith("test@example.com", "password123");
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockFns.mockNavigate).toHaveBeenCalledWith("/advisor");
  });
});
