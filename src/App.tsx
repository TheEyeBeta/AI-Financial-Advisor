import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import Landing from "./pages/Landing";
import Advisor from "./pages/Advisor";
import ChatHistory from "./pages/ChatHistory";
import Dashboard from "./pages/Dashboard";
import PaperTrading from "./pages/PaperTrading";
import News from "./pages/News";
import TopStocks from "./pages/TopStocks";
import Profile from "./pages/Profile";
import Onboarding from "./pages/Onboarding";
import Admin from "./pages/Admin";
import AuthCallback from "./pages/AuthCallback";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import AcademyLanding from "./pages/academy/AcademyLanding";
import AcademyTier from "./pages/academy/AcademyTier";
import AcademyLesson from "./pages/academy/AcademyLesson";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AdminRoute } from "./components/auth/AdminRoute";
import { AuthProvider } from "@/context/AuthContext";
import { healthCheck } from "@/services/healthCheck";
import { analytics } from "@/services/analytics";
import { AnalyticsPageTracker } from "@/components/AnalyticsPageTracker";

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
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
