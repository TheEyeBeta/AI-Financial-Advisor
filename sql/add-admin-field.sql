-- Add admin field to users table
-- This allows marking users as administrators

-- Add is_admin column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'is_admin'
    ) THEN
        ALTER TABLE public.users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Added is_admin column to users table';
    ELSE
        RAISE NOTICE 'is_admin column already exists';
    END IF;
END $$;

-- Create index for faster admin lookups
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON public.users(is_admin) WHERE is_admin = TRUE;

-- Grant necessary permissions
GRANT SELECT, UPDATE ON public.users TO authenticated;

-- Example: Make a specific user admin (replace 'user-email@example.com' with actual email)
-- UPDATE public.users SET is_admin = TRUE WHERE email = 'user-email@example.com';

COMMENT ON COLUMN public.users.is_admin IS 'Whether the user has administrator privileges';
