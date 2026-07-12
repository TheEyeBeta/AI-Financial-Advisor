import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { supabase } from "@/lib/supabase";
import { isGoogleAuthEnabled } from "@/lib/env";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { AuthDivider } from "@/components/auth/AuthDivider";

interface SignUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignIn?: () => void;
}

export function SignUpDialog({ open, onOpenChange, onSwitchToSignIn }: SignUpDialogProps) {
  const googleAuthEnabled = isGoogleAuthEnabled();
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setIsGoogleRedirecting(false);
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName || !lastName || !email || !password) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 10) {
      toast({
        title: "Error",
        description: "Password must be at least 10 characters",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback?verified=true`,
        },
      });

      if (authError) throw authError;

      if (
        authData.user &&
        (!authData.user.identities || authData.user.identities.length === 0)
      ) {
        toast({
          title: "Account already exists",
          description:
            "An account with this email already exists. Please sign in instead, or use a different email.",
          variant: "destructive",
        });
        return;
      }

      if (authData.user) {
        toast({
          title: "Account Created!",
          description:
            "Please check your email to verify your account. We've sent you a confirmation link.",
        });

        onOpenChange(false);
        resetForm();
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error) || "Failed to create account";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formDisabled = isLoading || isGoogleRedirecting;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetForm();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col p-0">
        <div className="flex-shrink-0 px-6 pt-6">
          <DialogHeader>
            <DialogTitle>Create your account</DialogTitle>
            <DialogDescription>
              Build your financial profile
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 py-4 px-6 overflow-y-auto flex-1 min-h-0">
          {googleAuthEnabled && (
            <GoogleAuthButton
              returnTo="/onboarding"
              onRedirectingChange={setIsGoogleRedirecting}
            />
          )}

          {googleAuthEnabled && <AuthDivider />}

          <form onSubmit={handleEmailSignUp} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signup-first-name">First name</Label>
                <Input
                  id="signup-first-name"
                  type="text"
                  autoComplete="given-name"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  disabled={formDisabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-last-name">Last name</Label>
                <Input
                  id="signup-last-name"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  disabled={formDisabled}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={formDisabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-password">Password</Label>
              <Input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                disabled={formDisabled}
              />
              <p className="text-xs text-muted-foreground">
                Must be at least 10 characters
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-confirm-password">Confirm password</Label>
              <Input
                id="signup-confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={formDisabled}
              />
            </div>

            <Button type="submit" className="w-full" disabled={formDisabled}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                "Create account"
              )}
            </Button>
          </form>

          {onSwitchToSignIn && (
            <p className="text-center text-sm text-muted-foreground">
              Already registered?{" "}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  onOpenChange(false);
                  onSwitchToSignIn();
                }}
              >
                Sign in
              </button>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
