import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Suspense, lazy, useEffect, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AdminRoute } from "./components/auth/AdminRoute";
import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/hooks/use-auth";
import { healthCheck } from "@/services/healthCheck";
import { analytics } from "@/services/analytics";
import { AnalyticsPageTracker } from "@/components/AnalyticsPageTracker";

const Landing = lazy(() => import("./pages/Landing"));
const Advisor = lazy(() => import("./pages/Advisor"));
const ChatHistory = lazy(() => import("./pages/ChatHistory"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const PaperTrading = lazy(() => import("./pages/PaperTrading"));
const News = lazy(() => import("./pages/News"));
const TopStocks = lazy(() => import("./pages/TopStocks"));
const Profile = lazy(() => import("./pages/Profile"));
const ProfileSettings = lazy(() => import("./pages/ProfileSettings"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Admin = lazy(() => import("./pages/Admin"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AcademyLanding = lazy(() => import("./pages/academy/AcademyLanding"));
const AcademyTier = lazy(() => import("./pages/academy/AcademyTier"));
const AcademyLesson = lazy(() => import("./pages/academy/AcademyLesson"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Do not retry on 4xx errors — they are permanent (table not found, auth errors, etc.)
      retry: (failureCount, error) => {
        const status = (error as { status?: number; code?: number })?.status;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
          <h1 className="mb-2 text-2xl font-bold text-foreground">Something went wrong</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            The application encountered an unexpected error.
          </p>
          <pre className="mb-6 max-w-xl overflow-auto rounded bg-muted p-4 text-left text-xs text-foreground">
            {this.state.error.message}
          </pre>
          <a href="/" className="text-sm text-primary underline hover:text-primary/80">
            Reload app
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
      Loading...
    </div>
  );
}

function OnboardingRouteGuard() {
  const { isAuthenticated, loading, profileLoading, onboardingComplete, userProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) return;
    if (loading || profileLoading || onboardingComplete === null) return;
    if (onboardingComplete !== false) return;
    if (userProfile?.userType === "Admin") return;
    if (location.pathname === "/onboarding") return;
    navigate("/onboarding", { replace: true });
  }, [isAuthenticated, loading, profileLoading, onboardingComplete, userProfile?.userType, location.pathname, navigate]);

  return null;
}

const App = () => {
  useEffect(() => {
    analytics.init();
    healthCheck.startMonitoring();

    return () => {
      healthCheck.stopMonitoring();
    };
  }, []);

  return (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <AnalyticsPageTracker />
          <OnboardingRouteGuard />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Landing page - shows when not authenticated */}
              <Route path="/" element={<Landing />} />

              {/* Onboarding - must be before other protected routes */}
              <Route
                path="/onboarding"
                element={
                  <ProtectedRoute>
                    <Onboarding />
                  </ProtectedRoute>
                }
              />

              {/* Protected routes - require authentication */}
              <Route
                path="/advisor"
                element={
                  <ProtectedRoute>
                    <Advisor />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/chat-history"
                element={
                  <ProtectedRoute>
                    <ChatHistory />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/learning"
                element={
                  <ProtectedRoute>
                    <Navigate to="/academy" replace />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/paper-trading"
                element={
                  <ProtectedRoute>
                    <PaperTrading />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/news"
                element={
                  <ProtectedRoute>
                    <News />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/top-stocks"
                element={
                  <ProtectedRoute>
                    <TopStocks />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfileSettings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/academy"
                element={
                  <ProtectedRoute>
                    <AcademyLanding />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/academy/:tier"
                element={
                  <ProtectedRoute>
                    <AcademyTier />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/academy/lesson/:slug"
                element={
                  <ProtectedRoute>
                    <AcademyLesson />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <AdminRoute>
                    <Admin />
                  </AdminRoute>
                }
              />

              {/* OAuth callback - public */}
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/auth/reset-password" element={<ResetPassword />} />

              {/* 404 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
  );
};

export default App;
