import { useState } from "react";
import { LogIn, LogOut, User, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { useNavigate } from "react-router-dom";

export function UserAuth() {
  const { user, userProfile, loading, signIn, signUp, signOut, isAuthenticated } = useAuth();
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [showSignUpDialog, setShowSignUpDialog] = useState(false);
  const [showJohnDoeDialog, setShowJohnDoeDialog] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const navigate = useNavigate();

  const handleSignInAsJohnDoe = async () => {
    setIsSigningIn(true);
    try {
      await signIn("john.doe@example.com", "TestPassword123!");
      toast({
        title: "Success",
        description: "Signed in as John Doe",
      });
      setShowJohnDoeDialog(false);
      navigate("/advisor");
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to sign in. Make sure John Doe user exists in Supabase Auth.",
        variant: "destructive",
      });
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleCustomSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        title: "Error",
        description: "Please enter both email and password",
        variant: "destructive",
      });
      return;
    }

    setIsSigningIn(true);
    try {
      await signIn(email, password);
      toast({
        title: "Success",
        description: "Signed in successfully",
      });
      setShowLoginDialog(false);
      setEmail("");
      setPassword("");
      navigate("/advisor");
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to sign in. Please check your credentials.",
        variant: "destructive",
      });
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({
        title: "Success",
        description: "Signed out successfully",
      });
      navigate("/advisor");
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to sign out",
        variant: "destructive",
      });
    }
  };


  const handleCustomSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        title: "Error",
        description: "Please enter both email and password",
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

    setIsSigningUp(true);
    try {
      await signUp(email, password);
      toast({
        title: "Success",
        description: "Account created! Please check your email to verify your account.",
      });
      setShowSignUpDialog(false);
      setEmail("");
      setPassword("");
      setConfirmPassword("");
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to create account. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSigningUp(false);
    }
  };

  if (loading) {
    return (
      <Button variant="ghost" size="sm" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    );
  }

  if (isAuthenticated && user) {
    // Get display name: first_name + last_name, or fallback to email
    const displayName = userProfile?.first_name && userProfile?.last_name
      ? `${userProfile.first_name} ${userProfile.last_name}`
      : userProfile?.first_name || user.email || "User";
    
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">
              {displayName}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs leading-none text-muted-foreground">
                {user.email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            onClick={() => navigate("/profile")} 
            className="cursor-pointer"
          >
            <User className="mr-2 h-4 w-4" />
            <span>Profile Settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sign Out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="flex items-center gap-2">
            <LogIn className="h-4 w-4" />
            <span className="hidden sm:inline">Sign In</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Authentication</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowLoginDialog(true)}
            className="cursor-pointer"
          >
            <LogIn className="mr-2 h-4 w-4" />
            <span>Sign In</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setShowSignUpDialog(true)}
            className="cursor-pointer"
          >
            <User className="mr-2 h-4 w-4" />
            <span>Sign Up</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowJohnDoeDialog(true)}
            className="cursor-pointer text-xs text-muted-foreground"
          >
            <User className="mr-2 h-3 w-3" />
            <span>Test: Sign in as John Doe</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* John Doe Quick Sign In Dialog */}
      <Dialog open={showJohnDoeDialog} onOpenChange={setShowJohnDoeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign in as John Doe</DialogTitle>
            <DialogDescription>
              Quick sign in with the test account. Make sure you've created the John Doe user in Supabase Auth dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value="john.doe@example.com" disabled />
            </div>
            <div className="space-y-2 mt-4">
              <Label>Password</Label>
              <Input type="password" value="TestPassword123!" disabled />
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              This will sign you in as the test user. If the user doesn't exist, create it in Supabase Auth dashboard first.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowJohnDoeDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSignInAsJohnDoe} disabled={isSigningIn}>
              {isSigningIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In as John Doe"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Sign In Dialog */}
      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign In</DialogTitle>
            <DialogDescription>
              Enter your email and password to sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <form onSubmit={handleCustomSignIn}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowLoginDialog(false);
                    setEmail("");
                    setPassword("");
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSigningIn}>
                  {isSigningIn ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sign Up Dialog */}
      <Dialog open={showSignUpDialog} onOpenChange={setShowSignUpDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Account</DialogTitle>
            <DialogDescription>
              Create a new account with email and password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <form onSubmit={handleCustomSignUp}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
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
                  <Label htmlFor="signup-password">Password</Label>
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
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowSignUpDialog(false);
                    setEmail("");
                    setPassword("");
                    setConfirmPassword("");
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSigningUp}>
                  {isSigningUp ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    "Sign Up"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
