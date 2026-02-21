import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Validate URL format
const isValidUrl = (url: string): boolean => {
  if (!url || url === 'your_supabase_project_url') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

// Create a dummy client if Supabase is not configured
const createDummyClient = () => {
  // Use a placeholder URL that won't cause errors
  const dummyUrl = 'https://placeholder.supabase.co';
  const dummyKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NDUxOTIwMDAsImV4cCI6MTk2MDc2ODAwMH0.placeholder';
  
  return createClient<Database>(dummyUrl, dummyKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};

if (!isValidUrl(supabaseUrl) || !supabaseAnonKey || supabaseAnonKey === 'your_supabase_anon_key') {
  console.warn(
    '⚠️  Supabase is not configured. The app will run in demo mode.\n' +
    'To enable authentication, please set valid values in your .env file:\n' +
    '  VITE_SUPABASE_URL=https://your-project.supabase.co\n' +
    '  VITE_SUPABASE_ANON_KEY=your-anon-key'
  );
}

export const supabase = isValidUrl(supabaseUrl) && supabaseAnonKey && supabaseAnonKey !== 'your_supabase_anon_key'
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Enable OAuth redirect handling
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined,
      },
    })
  : createDummyClient();

// Re-export from user-helpers for backward compatibility
export { getCurrentUserId, getCurrentUserProfile, getUserProfile } from './user-helpers';
