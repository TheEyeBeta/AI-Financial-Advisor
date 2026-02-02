import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUserProfile } from "@/lib/user-helpers";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type UserProfile = Database["public"]["Tables"]["users"]["Row"];

interface AuthContextValue {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean; // initial auth loading
  profileLoading: boolean; // background profile loading
  isAuthenticated: boolean;
  userId: string | null; // public.users.id
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
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileFetched, setProfileFetched] = useState<string | null>(null);

  // Initial session + auth subscription (single instance for the whole app)
  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      setAuthUser(session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      setLoading(false);
      // Reset profile cache when auth user changes
      setProfileFetched(null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch user profile once per auth user
  useEffect(() => {
    if (!authUser) {
      setUserProfile(null);
      setProfileLoading(false);
      setProfileFetched(null);
      return;
    }

    if (profileFetched === authUser.id) {
      return; // already fetched for this auth user
    }

    setProfileLoading(true);
    getCurrentUserProfile()
      .then((profile) => {
        setUserProfile(profile);
        setProfileLoading(false);
        setProfileFetched(authUser.id);
      })
      .catch((error) => {
        console.error("Error fetching user profile:", error);
        setUserProfile(null);
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
    return data;
  };

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
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
    setProfileFetched(null); // Reset cache to force refetch
    try {
      const profile = await getCurrentUserProfile();
      setUserProfile(profile);
      setProfileFetched(authUser.id);
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
    userId: userProfile?.id ?? null,
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

