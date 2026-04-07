import { createContext, useContext, useEffect, useState } from "react";
import { supabase, coreDb } from "@/lib/supabase";
import { getCurrentUserProfile } from "@/lib/user-helpers";
import { getSupabaseEnvConfig } from "@/lib/env";
import { analytics, AnalyticsEvents } from "@/services/analytics";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type AppUserProfile = Database["core"]["Tables"]["users"]["Row"];

interface AuthContextValue {
  user: User | null;
  userProfile: AppUserProfile | null;
  loading: boolean; // initial auth loading
  profileLoading: boolean; // background profile loading
  isAuthenticated: boolean;
  authUserId: string | null; // auth.users.id (auth.uid())
  appUserId: string | null; // core.users.id
  /** @deprecated Use appUserId instead. */
  userId: string | null;
  /** null = still loading, false = not complete, true = complete */
  onboardingComplete: boolean | null;
  signIn: (email: string, password: string) => Promise<unknown>;
  signUp: (email: string, password: string) => Promise<unknown>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<AppUserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileFetched, setProfileFetched] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  // Initial session + auth subscription (single instance for the whole app)
  useEffect(() => {
    let isMounted = true;

    // Handle missing Supabase config gracefully
    if (!getSupabaseEnvConfig().isConfigured) {
      // If Supabase is not configured, just set loading to false
      // The app should still render the landing page
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!isMounted) return;
      if (error) {
        console.warn('Supabase session error:', error);
        setLoading(false);
        return;
      }
      setAuthUser(session?.user ?? null);
      setLoading(false);
    }).catch((error) => {
      console.warn('Failed to get Supabase session:', error);
      if (!isMounted) return;
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setAuthUser(session?.user ?? null);
      setLoading(false);
      // Reset profile cache when auth user changes
      setProfileFetched(null);
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // Fetch user profile once per auth user, with secondary check for existing users
  useEffect(() => {
    if (!authUser) {
      setUserProfile(null);
      setOnboardingComplete(null);
      setProfileLoading(false);
      setProfileFetched(null);
      return;
    }

    if (profileFetched === authUser.id) {
      return; // already fetched for this auth user
    }

    setProfileLoading(true);
    getCurrentUserProfile()
      .then(async (profile) => {
        if (!profile) {
          setUserProfile(null);
          // Fail safe: no profile row means we cannot determine status — treat as incomplete
          setOnboardingComplete(false);
          setProfileLoading(false);
          setProfileFetched(authUser.id);
          return;
        }

        let isOnboardingComplete = profile.onboarding_complete ?? false;

        // Secondary check: if flag is false, see whether a user_profiles row already
        // exists (handles accounts that completed onboarding before the flag was added).
        if (!isOnboardingComplete) {
          try {
            const { count, error: countError } = await coreDb
              .from("user_profiles")
              .select("*", { count: "exact", head: true })
              .eq("user_id", profile.id);

            if (!countError && count && count > 0) {
              // Profile exists — silently backfill the flag and treat as complete.
              const { error: updateError } = await coreDb
                .from("users")
                .update({ onboarding_complete: true })
                .eq("id", profile.id);

              if (updateError) {
                console.error("Failed to backfill onboarding_complete:", updateError);
                // Fail safe: keep isOnboardingComplete = false so the flag can be
                // retried on next login rather than silently leaving bad state.
              } else {
                isOnboardingComplete = true;
              }
            }
            // If countError or count === 0: leave isOnboardingComplete = false (fail safe).
          } catch (err) {
            console.error("Error during user_profiles existence check:", err);
            // Fail safe: treat as incomplete so the user can re-run onboarding.
          }
        }

        setUserProfile(profile);
        setOnboardingComplete(isOnboardingComplete);
        setProfileLoading(false);
        setProfileFetched(authUser.id);
        analytics.identify(profile.id, {
          experience_level: profile.experience_level,
          risk_level: profile.risk_level,
          onboarding_complete: isOnboardingComplete,
        });
      })
      .catch((error) => {
        console.error("Error fetching user profile:", error);
        setUserProfile(null);
        // Fail safe: if the core.users fetch itself fails, treat as incomplete so
        // the app doesn't give full access on a broken state.
        setOnboardingComplete(false);
        setProfileLoading(false);
        setProfileFetched(authUser.id);
      });
  }, [authUser, profileFetched]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    AnalyticsEvents.signIn('email');
    return data;
  };

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    AnalyticsEvents.signUp('email');
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    AnalyticsEvents.signOut();
    analytics.reset();
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) throw error;
  };

  const refreshProfile = async () => {
    if (!authUser) return;

    setProfileLoading(true);
    // Do NOT reset profileFetched here — that would trigger the profile useEffect
    // to start a second concurrent fetch, racing against the one below.
    try {
      const profile = await getCurrentUserProfile();
      setUserProfile(profile);
      setOnboardingComplete(profile?.onboarding_complete ?? false);
      setProfileFetched(authUser.id); // Keep cache valid after refresh
    } catch (error) {
      console.error("Error refreshing user profile:", error);
    } finally {
      setProfileLoading(false);
    }
  };

  const value: AuthContextValue = {
    user: authUser,
    userProfile,
    loading,
    profileLoading,
    isAuthenticated: !!authUser,
    authUserId: authUser?.id ?? null,
    appUserId: userProfile?.id ?? null,
    userId: userProfile?.id ?? null,
    onboardingComplete,
    signIn,
    signUp,
    signOut,
    resetPassword,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return ctx;
}
