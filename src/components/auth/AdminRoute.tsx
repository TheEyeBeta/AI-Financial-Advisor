import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { loading, profileLoading, isAuthenticated, userProfile } = useAuth();
  const location = useLocation();

  // Wait for both auth and profile to load
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

  // If authenticated but profile hasn't arrived yet, keep showing the loader.
  // There is a one-render-cycle gap between auth resolving (loading → false) and
  // the profile effect calling setProfileLoading(true), so profileLoading can be
  // false while userProfile is still null on a fresh direct navigation.
  // Redirecting in that window incorrectly boots admin users to /advisor.
  if (!userProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Profile is loaded — redirect non-admins
  if (userProfile.userType !== 'Admin') {
    return <Navigate to="/advisor" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
