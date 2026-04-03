import { useState } from "react";
import { Loader2, LogIn, LogOut, User } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignInDialog } from "@/components/auth/SignInDialog";
import { SignUpDialog } from "@/components/auth/SignUpDialog";

export function UserAuth() {
  const { user, userProfile, loading, signOut, isAuthenticated } = useAuth();
  const [showSignInDialog, setShowSignInDialog] = useState(false);
  const [showSignUpDialog, setShowSignUpDialog] = useState(false);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({
        title: "Signed out",
        description: "You have been signed out successfully.",
      });
      navigate("/", { replace: true });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to sign out.",
        variant: "destructive",
      });
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
    const displayName = userProfile?.first_name && userProfile?.last_name
      ? `${userProfile.first_name} ${userProfile.last_name}`
      : userProfile?.first_name || user.email || "User";

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">{displayName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/profile")} className="cursor-pointer">
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
          <DropdownMenuLabel>Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowSignInDialog(true)} className="cursor-pointer">
            <LogIn className="mr-2 h-4 w-4" />
            <span>Sign In</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowSignUpDialog(true)} className="cursor-pointer">
            <User className="mr-2 h-4 w-4" />
            <span>Create Account</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SignInDialog open={showSignInDialog} onOpenChange={setShowSignInDialog} />
      <SignUpDialog open={showSignUpDialog} onOpenChange={setShowSignUpDialog} />
    </>
  );
}
