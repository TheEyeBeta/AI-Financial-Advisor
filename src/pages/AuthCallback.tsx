import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { sanitizeReturnPath } from "@/lib/auth-redirect";
import { Button } from "@/components/ui/button";

const PROFILE_WAIT_MS = 10000;
const SUPABASE_PROCESSING_DELAY_MS = 1000;

function stripAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  const paramsToRemove = ["code", "access_token", "refresh_token", "error", "error_description", "error_code", "type"];
  let changed = false;

  paramsToRemove.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });

  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    paramsToRemove.forEach((key) => hashParams.delete(key));
    const newHash = hashParams.toString();
    if (newHash !== url.hash.replace(/^#/, "")) {
      url.hash = newHash ? `#${newHash}` : "";
      changed = true;
    }
  }

  if (changed) {
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userProfile, profileLoading, onboardingComplete } = useAuth();
  const [phase, setPhase] = useState<"loading" | "error" | "routing">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessionReadyRef = useRef(false);
  const routedRef = useRef(false);

  const nextPath = sanitizeReturnPath(searchParams.get("next"));
  const oauthError = searchParams.get("error");
  const oauthErrorDescription = searchParams.get("error_description");

  useEffect(() => {
    if (oauthError) {
      const message =
        oauthError === "access_denied"
          ? "Google sign-in was cancelled. You can try again when ready."
          : oauthErrorDescription || "Authentication was not completed. Please try again.";
      setErrorMessage(message);
      setPhase("error");
      stripAuthParamsFromUrl();
      return;
    }

    let isMounted = true;
    let subscription: { unsubscribe: () => void } | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const establishSession = async () => {
      const hasAuthParams =
        window.location.hash.includes("access_token") ||
        window.location.hash.includes("code") ||
        searchParams.has("code") ||
        searchParams.has("access_token") ||
        searchParams.has("verified");

      if (!hasAuthParams) {
        if (isMounted) navigate("/", { replace: true });
        return;
      }

      const verified = searchParams.get("verified");
      await new Promise((resolve) => setTimeout(resolve, SUPABASE_PROCESSING_DELAY_MS));
      if (!isMounted) return;

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        if (!isMounted) return;
        if (verified === "true") {
          toast({
            title: "Email Verified!",
            description: "Your account has been verified. Please sign in.",
          });
          navigate("/?verified=true", { replace: true });
        } else {
          setErrorMessage("Authentication failed. Please try signing in again.");
          setPhase("error");
        }
        stripAuthParamsFromUrl();
        return;
      }

      if (session) {
        sessionReadyRef.current = true;
        setPhase("routing");
        return;
      }

      const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
        if (!isMounted) return;
        if (event === "SIGNED_IN" && newSession) {
          authSubscription.unsubscribe();
          if (timeoutId) clearTimeout(timeoutId);
          sessionReadyRef.current = true;
          setPhase("routing");
        }
      });

      subscription = authSubscription;

      timeoutId = setTimeout(() => {
        if (!isMounted || sessionReadyRef.current) return;
        authSubscription.unsubscribe();
        if (verified === "true") {
          toast({
            title: "Email Verified!",
            description: "Your account has been verified. Please sign in.",
          });
          navigate("/?verified=true", { replace: true });
        } else {
          setErrorMessage("Authentication timed out. Please try signing in again.");
          setPhase("error");
        }
        stripAuthParamsFromUrl();
      }, PROFILE_WAIT_MS);
    };

    establishSession();

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [navigate, oauthError, oauthErrorDescription, searchParams]);

  useEffect(() => {
    if (phase !== "routing" || routedRef.current) return;
    if (profileLoading || onboardingComplete === null) return;

    routedRef.current = true;
    stripAuthParamsFromUrl();

    if (userProfile?.userType === "Admin") {
      navigate("/admin", { replace: true });
      return;
    }

    if (onboardingComplete === false) {
      navigate("/onboarding", { replace: true });
      return;
    }

    navigate(nextPath, { replace: true });
  }, [phase, profileLoading, onboardingComplete, userProfile, navigate, nextPath]);

  useEffect(() => {
    if (phase !== "routing" || routedRef.current) return;

    const profileTimeoutId = setTimeout(() => {
      if (routedRef.current) return;
      setErrorMessage(
        "Your account was authenticated but profile setup could not be completed. Please try signing in again or contact support.",
      );
      setPhase("error");
      stripAuthParamsFromUrl();
    }, PROFILE_WAIT_MS);

    return () => clearTimeout(profileTimeoutId);
  }, [phase]);

  if (phase === "error" && errorMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">Sign-in incomplete</h1>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
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
