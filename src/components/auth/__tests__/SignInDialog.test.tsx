import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SignInDialog } from "@/components/auth/SignInDialog";

const mockSignIn = vi.fn();
const mockNavigate = vi.fn();
const mockToast = vi.fn();

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    signIn: mockSignIn,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
}));

describe("SignInDialog", () => {
  beforeEach(() => {
    mockSignIn.mockResolvedValue({ user: { id: "user-1" } });
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
      expect(mockSignIn).toHaveBeenCalledWith("test@example.com", "password123");
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith("/advisor");
  });
});
