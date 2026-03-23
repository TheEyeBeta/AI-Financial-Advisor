import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AdminRoute } from "./components/auth/AdminRoute";
import { AuthProvider } from "@/context/AuthContext";
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

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
      Loading...
    </div>
  );
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
                    <Profile />
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
  );
};

export default App;
