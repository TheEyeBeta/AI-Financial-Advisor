-- Alternative User ID Options (SAFER than using password)
-- Choose ONE of these approaches:

-- OPTION 1: Keep auth.users.id but add a separate "username" or "user_code" field
-- This is the RECOMMENDED approach
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS user_code TEXT UNIQUE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_user_code ON public.users(user_code);

-- OPTION 2: Use email as a secondary identifier (already have this)
-- You can query by email: SELECT * FROM users WHERE email = 'user@example.com'

-- OPTION 3: Generate a custom user ID (but still keep auth.users.id as primary key)
-- This allows you to have a "public" user ID that's not the auth UUID
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS public_user_id TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT;

-- OPTION 4: Use a sequential number (like user #1, #2, etc.)
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS user_number SERIAL UNIQUE;

-- After choosing an option, update your queries to use the new field instead of id
-- Example: SELECT * FROM users WHERE username = 'john_doe'
-- Example: SELECT * FROM users WHERE user_code = 'USR12345'
