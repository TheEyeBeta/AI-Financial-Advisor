import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireVerification?: boolean;
}

export function ProtectedRoute({ children, requireVerification = false }: ProtectedRouteProps) {
  const { user, loading, isAuthenticated, userProfile, profileLoading } = useAuth();
  const location = useLocation();

  // Only show loading on initial auth check, not during navigation
  if (loading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to landing page if not authenticated
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  // Check if user needs to complete onboarding
  // Skip onboarding check for admins
  // Only check if we're not already on the onboarding page
  if (
    userProfile && 
    !userProfile.onboarding_complete && 
    userProfile.userType !== "Admin" &&
    location.pathname !== "/onboarding"
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  // If user is on onboarding page but has already completed it, redirect to main page
  if (userProfile && userProfile.onboarding_complete && location.pathname === "/onboarding") {
    return <Navigate to="/advisor" replace />;
  }

  // If admin tries to access onboarding, redirect to admin page
  if (userProfile && userProfile.userType === "Admin" && location.pathname === "/onboarding") {
    return <Navigate to="/admin" replace />;
  }

  // Render children immediately - don't wait for profile to load
  // Profile will load in background and update components that need it

  if (requireVerification && user) {
    // Check if user is verified
    // For now, we'll allow access and let the backend handle verification checks
    // You can add verification check here if needed
  }

  return <>{children}</>;
}
