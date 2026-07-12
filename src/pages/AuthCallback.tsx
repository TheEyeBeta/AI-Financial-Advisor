import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { resolvePostAuthPath, sanitizeReturnPath } from "@/lib/auth-redirect";
import { stripAuthParamsFromUrl } from "@/lib/auth-callback";
import {
  AUTH_CALLBACK_PROFILE_WAIT_MS,
  useAuthCallbackSession,
} from "@/hooks/use-auth-callback-session";
import { Button } from "@/components/ui/button";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userProfile, profileLoading, onboardingComplete } = useAuth();
  const routedRef = useRef(false);
  const [profileSetupError, setProfileSetupError] = useState<string | null>(null);

  const nextPath = sanitizeReturnPath(searchParams.get("next"));
  const { phase, errorMessage } = useAuthCallbackSession(searchParams, navigate);

  useEffect(() => {
    if (phase !== "routing" || routedRef.current) return;
    if (profileLoading || onboardingComplete === null) return;

    routedRef.current = true;
    stripAuthParamsFromUrl();

    const destination = resolvePostAuthPath(
      {
        userType: userProfile?.userType,
        onboardingComplete,
      },
      nextPath,
    );
    navigate(destination, { replace: true });
  }, [phase, profileLoading, onboardingComplete, userProfile, navigate, nextPath]);

  useEffect(() => {
    if (phase !== "routing" || routedRef.current) return;

    const profileTimeoutId = setTimeout(() => {
      if (routedRef.current) return;
      setProfileSetupError(
        "Your account was authenticated but profile setup could not be completed. Please try signing in again or contact support.",
      );
      stripAuthParamsFromUrl();
    }, AUTH_CALLBACK_PROFILE_WAIT_MS);

    return () => clearTimeout(profileTimeoutId);
  }, [phase]);

  const resolvedError = profileSetupError ?? errorMessage;
  const isError = Boolean(resolvedError) && (phase === "error" || profileSetupError !== null);

  if (isError && resolvedError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">Sign-in incomplete</h1>
          <p className="text-sm text-muted-foreground">{resolvedError}</p>
          <Button asChild>
            <Link to="/">Return home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground">
          {phase === "routing" ? "Redirecting..." : "Completing sign in..."}
        </p>
      </div>
    </div>
  );
}
