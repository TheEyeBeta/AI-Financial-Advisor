import { useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import {
  getOAuthErrorMessage,
  hasAuthCallbackParams,
  stripAuthParamsFromUrl,
} from '@/lib/auth-callback';

const PROFILE_WAIT_MS = 10_000;
const SUPABASE_PROCESSING_DELAY_MS = 1_000;

export type AuthCallbackPhase = 'loading' | 'error' | 'routing';

function redirectAfterEmailVerification(navigate: NavigateFunction) {
  toast({
    title: 'Email Verified!',
    description: 'Your account has been verified. Please sign in.',
  });
  navigate('/?verified=true', { replace: true });
}

export function useAuthCallbackSession(
  searchParams: URLSearchParams,
  navigate: NavigateFunction,
) {
  const [phase, setPhase] = useState<AuthCallbackPhase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessionReadyRef = useRef(false);

  const oauthError = searchParams.get('error');
  const oauthErrorDescription = searchParams.get('error_description');

  useEffect(() => {
    const oauthMessage = getOAuthErrorMessage(oauthError, oauthErrorDescription);
    if (oauthMessage) {
      setErrorMessage(oauthMessage);
      setPhase('error');
      stripAuthParamsFromUrl();
      return;
    }

    let isMounted = true;
    let subscription: { unsubscribe: () => void } | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const establishSession = async () => {
      if (!hasAuthCallbackParams(searchParams)) {
        if (isMounted) navigate('/', { replace: true });
        return;
      }

      const verified = searchParams.get('verified');
      await new Promise((resolve) => setTimeout(resolve, SUPABASE_PROCESSING_DELAY_MS));
      if (!isMounted) return;

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        if (!isMounted) return;
        if (verified === 'true') {
          redirectAfterEmailVerification(navigate);
        } else {
          setErrorMessage('Authentication failed. Please try signing in again.');
          setPhase('error');
        }
        stripAuthParamsFromUrl();
        return;
      }

      if (session) {
        sessionReadyRef.current = true;
        setPhase('routing');
        return;
      }

      const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
        (event, newSession) => {
          if (!isMounted) return;
          if (event === 'SIGNED_IN' && newSession) {
            authSubscription.unsubscribe();
            if (timeoutId) clearTimeout(timeoutId);
            sessionReadyRef.current = true;
            setPhase('routing');
          }
        },
      );

      subscription = authSubscription;

      timeoutId = setTimeout(() => {
        if (!isMounted || sessionReadyRef.current) return;
        authSubscription.unsubscribe();
        if (verified === 'true') {
          redirectAfterEmailVerification(navigate);
        } else {
          setErrorMessage('Authentication timed out. Please try signing in again.');
          setPhase('error');
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

  return { phase, errorMessage, sessionReadyRef };
}

export const AUTH_CALLBACK_PROFILE_WAIT_MS = PROFILE_WAIT_MS;
