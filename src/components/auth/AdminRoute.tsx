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

  // Check if user is admin (using userType enum)
  // Only redirect if profile is loaded and user is not admin
  if (userProfile && userProfile.userType !== 'Admin') {
    // Redirect to advisor if not admin
    return <Navigate to="/advisor" replace state={{ from: location }} />;
  }

  // If profile is still null after loading, also redirect (safety check)
  if (!userProfile) {
    return <Navigate to="/advisor" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
