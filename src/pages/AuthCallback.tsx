import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let subscription: { unsubscribe: () => void } | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    
    const handleAuthCallback = async () => {
      try {
        // Check if this looks like an auth callback
        const hasAuthParams = 
          window.location.hash.includes('access_token') ||
          window.location.hash.includes('code') ||
          searchParams.has('code') ||
          searchParams.has('access_token') ||
          searchParams.has('verified');
        
        if (!hasAuthParams) {
          // Not an auth callback, redirect to home
          console.warn('Auth callback accessed without auth parameters');
          if (isMounted) {
            navigate('/');
            setLoading(false);
          }
          return;
        }

        // Wait a moment for Supabase to process URL hash/query params
        // With detectSessionInUrl: true, Supabase processes these automatically
        const SUPABASE_PROCESSING_DELAY = 1000;
        await new Promise(resolve => setTimeout(resolve, SUPABASE_PROCESSING_DELAY));

        if (!isMounted) return;

        // Check for session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Auth callback error:', sessionError);
          if (isMounted) {
            const verified = searchParams.get('verified');
            if (verified === 'true') {
              toast({
                title: "Email Verified!",
                description: "Your account has been verified. Please sign in.",
              });
              navigate('/?verified=true');
            } else {
              navigate('/?error=auth_failed');
            }
            setLoading(false);
          }
          return;
        }

        if (session && isMounted) {
          // User is authenticated, redirect to dashboard
          navigate('/');
          setLoading(false);
          return;
        }

        if (!isMounted) return;

        // No session yet - listen for auth state changes
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
          if (!isMounted) return;
          
          if (event === 'SIGNED_IN' && newSession) {
            if (authSubscription) authSubscription.unsubscribe();
            if (timeoutId) clearTimeout(timeoutId);
            navigate('/advisor');
            setLoading(false);
          }
        });
        
        subscription = authSubscription;

        // Timeout after 10 seconds
        const AUTH_TIMEOUT_MS = 10000;
        timeoutId = setTimeout(() => {
          if (!isMounted) return;
          
          if (authSubscription) authSubscription.unsubscribe();
          const verified = searchParams.get('verified');
          if (verified === 'true') {
            toast({
              title: "Email Verified!",
              description: "Your account has been verified. Please sign in.",
            });
            navigate('/?verified=true');
          } else {
            toast({
              title: "Authentication Timeout",
              description: "Please try signing in again.",
              variant: "destructive",
            });
            navigate('/?error=timeout');
          }
          setLoading(false);
        }, AUTH_TIMEOUT_MS);

      } catch (error) {
        console.error('Error handling auth callback:', error);
        if (isMounted) {
          navigate('/?error=auth_failed');
          setLoading(false);
        }
      }
    };

    handleAuthCallback();

    // Cleanup function - ensures all resources are properly cleaned up
    return () => {
      isMounted = false;
      if (subscription) subscription.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [navigate, searchParams]);


  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Completing sign in...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    </div>
  );
}
