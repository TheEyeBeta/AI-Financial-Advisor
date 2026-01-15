-- Migration: Add email verification columns to public.users table
-- Run this if you already have the schema running to add the new columns
-- This is safe to run multiple times (idempotent)

-- Step 1: Add new columns to users table (if they don't exist)
DO $$
BEGIN
    -- Add is_verified column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'is_verified'
    ) THEN
        ALTER TABLE public.users 
        ADD COLUMN is_verified BOOLEAN DEFAULT FALSE;
        
        RAISE NOTICE 'Added is_verified column to public.users';
    ELSE
        RAISE NOTICE 'Column is_verified already exists';
    END IF;

    -- Add email_verified_at column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'email_verified_at'
    ) THEN
        ALTER TABLE public.users 
        ADD COLUMN email_verified_at TIMESTAMPTZ;
        
        RAISE NOTICE 'Added email_verified_at column to public.users';
    ELSE
        RAISE NOTICE 'Column email_verified_at already exists';
    END IF;
END $$;

-- Step 2: Update existing users with verification status from auth.users
UPDATE public.users u
SET 
    is_verified = COALESCE(au.email_confirmed_at IS NOT NULL, false),
    email_verified_at = au.email_confirmed_at,
    updated_at = NOW()
FROM auth.users au
WHERE u.id = au.id
AND (
    u.is_verified IS DISTINCT FROM (au.email_confirmed_at IS NOT NULL)
    OR u.email_verified_at IS DISTINCT FROM au.email_confirmed_at
);

-- Step 3: Create/Update function to sync email verification from auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Create user profile in public.users when auth user is created
    INSERT INTO public.users (id, email, is_verified, email_verified_at, created_at, updated_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        NEW.email_confirmed_at,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        is_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        email_verified_at = NEW.email_confirmed_at,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Create/Update trigger for new users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Step 5: Create/Update function to handle email verification
CREATE OR REPLACE FUNCTION public.handle_email_verification()
RETURNS TRIGGER AS $$
BEGIN
    -- Update public.users when email_confirmed_at changes in auth.users
    IF NEW.email_confirmed_at IS NOT NULL AND (OLD.email_confirmed_at IS NULL OR OLD.email_confirmed_at != NEW.email_confirmed_at) THEN
        UPDATE public.users
        SET 
            is_verified = true,
            email_verified_at = NEW.email_confirmed_at,
            updated_at = NOW()
        WHERE id = NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 6: Create/Update trigger for email verification
DROP TRIGGER IF EXISTS on_email_verified ON auth.users;
CREATE TRIGGER on_email_verified
    AFTER UPDATE OF email_confirmed_at ON auth.users
    FOR EACH ROW
    WHEN (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
    EXECUTE FUNCTION public.handle_email_verification();

-- Success message
SELECT 
    '✅ Migration completed successfully!' AS status,
    COUNT(*) AS users_synced
FROM public.users
WHERE is_verified IS NOT NULL;
