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
    let subscription: { unsubscribe: () => void } | null = null;
    
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
          navigate('/');
          setLoading(false);
          return;
        }

        // Wait a moment for Supabase to process URL hash/query params
        // With detectSessionInUrl: true, Supabase processes these automatically
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check for session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Auth callback error:', sessionError);
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
          return;
        }

        if (session) {
          // User is authenticated, redirect to dashboard
          navigate('/');
          setLoading(false);
          return;
        }

        // No session yet - listen for auth state changes
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
          if (event === 'SIGNED_IN' && newSession) {
            authSubscription.unsubscribe();
            navigate('/advisor');
            setLoading(false);
          } else if (event === 'TOKEN_REFRESHED' && newSession) {
            // Session refreshed, redirect to dashboard
            authSubscription.unsubscribe();
            navigate('/advisor');
            setLoading(false);
          }
        });
        
        subscription = authSubscription;

        // Timeout after 10 seconds
        setTimeout(() => {
          authSubscription.unsubscribe();
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
        }, 10000);

      } catch (error) {
        console.error('Error handling auth callback:', error);
        if (subscription) {
          subscription.unsubscribe();
        }
        navigate('/?error=auth_failed');
        setLoading(false);
      }
    };

    handleAuthCallback();

    // Cleanup
    return () => {
      if (subscription) subscription.unsubscribe();
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
