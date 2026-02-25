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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

interface SignUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SignUpStep = "credentials" | "experience";

export function SignUpDialog({ open, onOpenChange }: SignUpDialogProps) {
  const { signUp: _signUp } = useAuth();
  const _navigate = useNavigate();
  const [step, setStep] = useState<SignUpStep>("credentials");
  const [isLoading, setIsLoading] = useState(false);

  // Step 1: Credentials
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [age, setAge] = useState<string>("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Step 2: Experience
  const [experienceLevel, setExperienceLevel] = useState<string>("beginner");

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!firstName || !lastName || !age || !email || !password) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum) || ageNum < 13 || ageNum > 150) {
      toast({
        title: "Error",
        description: "Please enter a valid age (13-150)",
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

    if (password.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // Sign up with email/password
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            age: ageNum,
            experience_level: experienceLevel,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback?verified=true`,
        },
      });

      if (authError) throw authError;

      if (authData.user) {
        // User profile is created automatically by database trigger (handle_new_user)
        // The trigger uses auth_id to reference auth.users(id)
        // No manual upsert needed - trigger handles it with the metadata we passed

        toast({
          title: "Account Created!",
          description: "Please check your email to verify your account. We've sent you a confirmation link.",
        });

        // Close dialog and show verification message
        onOpenChange(false);
        setStep("credentials");
        setFirstName("");
        setLastName("");
        setAge("");
        setEmail("");
        setPassword("");
        setConfirmPassword("");
        setExperienceLevel("beginner");
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


  if (step === "experience") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tell us about your experience</DialogTitle>
            <DialogDescription>
              Help us personalize your learning journey. You can change this later in settings.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleExperienceSubmit(); }}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="experience">Finance Experience Level</Label>
                <Select
                  value={experienceLevel}
                  onValueChange={setExperienceLevel}
                >
                  <SelectTrigger id="experience">
                    <SelectValue placeholder="Select your experience level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This helps us tailor content and recommendations to your level.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep("credentials");
                  setExperienceLevel("beginner");
                }}
              >
                Back
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Complete Sign Up"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col p-0">
        <div className="flex-shrink-0 px-6 pt-6">
          <DialogHeader>
            <DialogTitle>Create Your Account</DialogTitle>
            <DialogDescription>
              Start your journey to financial mastery. All fields are required.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 py-4 px-6 overflow-y-auto flex-1 min-h-0">
          <form onSubmit={handleEmailSignUp} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="signup-first-name">First Name *</Label>
                <Input
                  id="signup-first-name"
                  type="text"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-last-name">Last Name *</Label>
                <Input
                  id="signup-last-name"
                  type="text"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-age">Age *</Label>
              <Input
                id="signup-age"
                type="number"
                placeholder="25"
                min="13"
                max="150"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Must be between 13 and 150
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-email">Email *</Label>
              <Input
                id="signup-email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-password">Password *</Label>
              <Input
                id="signup-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              <p className="text-xs text-muted-foreground">
                Must be at least 6 characters
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-confirm-password">Confirm Password *</Label>
              <Input
                id="signup-confirm-password"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-experience">Finance Experience Level *</Label>
              <Select
                value={experienceLevel}
                onValueChange={setExperienceLevel}
              >
                <SelectTrigger id="signup-experience">
                  <SelectValue placeholder="Select your experience level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                You can change this later in your profile settings
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                "Create Account"
              )}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
