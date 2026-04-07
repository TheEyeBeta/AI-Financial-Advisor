import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireVerification?: boolean;
}

export function ProtectedRoute({ children, requireVerification = false }: ProtectedRouteProps) {
  const { user, loading, isAuthenticated, userProfile, profileLoading, onboardingComplete } = useAuth();
  const location = useLocation();

  // Wait for auth resolution and profile load before making routing decisions.
  // onboardingComplete is null while loading, so we must wait here to avoid
  // a premature redirect before the secondary user_profiles check completes.
  // Also block when the user is authenticated but onboardingComplete is still
  // null — this covers the micro-window between auth resolving and the profile
  // useEffect starting (profileLoading is still false in that window).
  if (loading || profileLoading || (isAuthenticated && onboardingComplete === null)) {
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

  // If admin tries to access onboarding, redirect to admin page.
  if (userProfile?.userType === "Admin" && location.pathname === "/onboarding") {
    return <Navigate to="/admin" replace />;
  }

  // Gate: authenticated but onboarding not complete → send to /onboarding.
  // Uses strict false check so null (still loading) never triggers a redirect.
  // Admins are exempt. Users already on /onboarding are exempt (no loop).
  if (
    onboardingComplete === false &&
    userProfile?.userType !== "Admin" &&
    location.pathname !== "/onboarding"
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  // If user has completed onboarding but lands on /onboarding, send them home.
  if (onboardingComplete === true && location.pathname === "/onboarding") {
    return <Navigate to="/advisor" replace />;
  }

  if (requireVerification && user) {
    // For now, we'll allow access and let the backend handle verification checks
  }

  return <>{children}</>;
}
