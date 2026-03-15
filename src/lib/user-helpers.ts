import { supabase } from './supabase';
import type { Database } from '@/types/database';

type UserProfile = Database['public']['Tables']['users']['Row'];

/**
 * Get user profile from auth user ID
 * Works with both old structure (id = auth.id) and new structure (auth_id column)
 */
export async function getUserProfile(authId: string): Promise<UserProfile | null> {
  // Try new structure first (auth_id column exists)
  const { data, error } = await supabase
    .schema('core')
    .from('users')
    .select('*')
    .eq('auth_id', authId)
    .single();

  // If no rows found (PGRST116), fall back to old structure where id = auth.id
  if (error && error.code === 'PGRST116') {
    const { data: oldData, error: oldError } = await supabase
      .schema('core')
      .from('users')
      .select('*')
      .eq('id', authId)
      .single();

    if (oldError) {
      console.error('Error fetching user profile:', oldError);
      return null;
    }
    return oldData;
  }

  if (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }

  return data;
}

/**
 * Get current user's profile
 * Returns the user profile for the currently authenticated user
 */
export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const { data: { user: authUser } } = await supabase.auth.getUser();
  
  if (!authUser) {
    return null;
  }

  return getUserProfile(authUser.id);
}

/**
 * Get current user's profile ID (the independent user.id, not auth.id)
 * This is the ID that should be used for foreign key relationships
 */
export async function getCurrentUserId(): Promise<string | null> {
  const profile = await getCurrentUserProfile();
  return profile?.id || null;
}
