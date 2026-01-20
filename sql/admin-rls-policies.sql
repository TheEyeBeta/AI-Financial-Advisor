-- Fix RLS policies to allow admins to see all users
-- Run this in Supabase SQL Editor

-- First, create a helper function that checks if current user is admin (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users 
    WHERE auth_id = auth.uid() 
    AND "userType" = 'Admin'
  );
$$;

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can view profiles" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update profiles" ON public.users;
DROP POLICY IF EXISTS "Admins can delete users" ON public.users;

-- Create new policy: Users can view own profile OR admins can view all
CREATE POLICY "Users can view profiles"
ON public.users FOR SELECT
USING (
  -- User can see their own profile
  auth_id = auth.uid()
  OR
  -- Admins can see all profiles (using function to avoid circular dependency)
  public.is_current_user_admin()
);

-- Allow admins to update any user
CREATE POLICY "Users can update profiles"
ON public.users FOR UPDATE
USING (
  -- User can update their own profile
  auth_id = auth.uid()
  OR
  -- Admins can update all profiles
  public.is_current_user_admin()
);

-- Allow admins to delete users (except themselves)
CREATE POLICY "Admins can delete users"
ON public.users FOR DELETE
USING (
  -- Only admins can delete
  public.is_current_user_admin()
  AND auth_id != auth.uid()  -- Can't delete yourself
);

-- Verify policies
SELECT schemaname, tablename, policyname, cmd 
FROM pg_policies 
WHERE tablename = 'users';
