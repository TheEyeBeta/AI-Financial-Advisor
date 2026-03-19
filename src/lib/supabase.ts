import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { assertSupabaseConfigForProduction, getSupabaseEnvConfig } from './env';

const supabaseConfig = getSupabaseEnvConfig();
assertSupabaseConfigForProduction(supabaseConfig);

// Create a dummy client if Supabase is not configured
const createDummyClient = () => {
  // Use a placeholder URL that won't cause errors
  const dummyUrl = 'https://placeholder.supabase.co';
  const dummyKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NDUxOTIwMDAsImV4cCI6MTk2MDc2ODAwMH0.placeholder';
  
  return createClient<Database>(dummyUrl, dummyKey, {
    db: {
      schema: 'public',
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};

if (!supabaseConfig.isConfigured) {
  console.warn(
    '⚠️  Supabase is not configured. The app will run in demo mode.\n' +
    'To enable authentication, please set valid values in your .env file:\n' +
    '  VITE_SUPABASE_URL=https://your-project.supabase.co\n' +
    '  VITE_SUPABASE_ANON_KEY=your-anon-key'
  );
}

export const supabase = supabaseConfig.isConfigured
  ? createClient<Database>(supabaseConfig.supabaseUrl, supabaseConfig.supabaseAnonKey, {
      db: {
        schema: 'public',
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Enable OAuth redirect handling
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined,
      },
    })
  : createDummyClient();

export const aiDb = supabase.schema('ai');
export const coreDb = supabase.schema('core');
export const tradingDb = supabase.schema('trading');
export const marketDb = supabase.schema('market');
export const academyDb = supabase.schema('academy');
export const meridianDb = supabase.schema('meridian');

// Re-export from user-helpers for backward compatibility
export { getCurrentUserId, getCurrentUserProfile, getUserProfile } from './user-helpers';
