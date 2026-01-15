-- Disable RLS on users table
-- WARNING: This removes row-level security - users can see/modify all other users' data
-- Only use this if you have other security measures in place

ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- Verify RLS is disabled
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'users';
