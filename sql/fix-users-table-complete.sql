-- Complete Fix for public.users Table
-- This script will:
-- 1. Remove password column (passwords should only be in auth.users)
-- 2. Add name and experience_level columns
-- 3. Create the trigger to auto-create users
-- 4. Sync existing users

-- Step 1: Create ENUM types
DO $$
BEGIN
    -- Create experience_level ENUM if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'experience_level_enum') THEN
        CREATE TYPE experience_level_enum AS ENUM ('beginner', 'intermediate', 'advanced');
        RAISE NOTICE '✅ Created experience_level_enum type';
    ELSE
        RAISE NOTICE 'experience_level_enum type already exists';
    END IF;

    -- Create risk_level ENUM if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_level_enum') THEN
        CREATE TYPE risk_level_enum AS ENUM ('low', 'mid', 'high', 'very_high');
        RAISE NOTICE '✅ Created risk_level_enum type';
    ELSE
        RAISE NOTICE 'risk_level_enum type already exists';
    END IF;
END $$;

-- Step 1b: Remove password column (if it exists)
-- Passwords should NEVER be in public.users - they're in auth.users
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'password'
    ) THEN
        ALTER TABLE public.users DROP COLUMN password;
        RAISE NOTICE '✅ Removed password column (passwords belong in auth.users only)';
    ELSE
        RAISE NOTICE 'Password column does not exist (good!)';
    END IF;
END $$;

-- Step 2: Remove old name column if it exists (migration from single name to first/last)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'name'
    ) THEN
        -- Split existing name into first_name and last_name if possible
        UPDATE public.users
        SET 
            first_name = CASE 
                WHEN name IS NOT NULL THEN SPLIT_PART(name, ' ', 1)
                ELSE NULL
            END,
            last_name = CASE 
                WHEN name IS NOT NULL AND POSITION(' ' IN name) > 0 THEN SUBSTRING(name FROM POSITION(' ' IN name) + 1)
                ELSE NULL
            END
        WHERE name IS NOT NULL;
        
        ALTER TABLE public.users DROP COLUMN name;
        RAISE NOTICE '✅ Migrated name column to first_name and last_name';
    ELSE
        RAISE NOTICE 'Column name does not exist (good, using first_name/last_name)';
    END IF;
END $$;

-- Step 2b: Add first_name column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'first_name'
    ) THEN
        ALTER TABLE public.users 
        ADD COLUMN first_name TEXT;
        
        RAISE NOTICE '✅ Added first_name column to public.users';
    ELSE
        RAISE NOTICE 'Column first_name already exists';
    END IF;
END $$;

-- Step 2c: Add last_name column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'last_name'
    ) THEN
        ALTER TABLE public.users 
        ADD COLUMN last_name TEXT;
        
        RAISE NOTICE '✅ Added last_name column to public.users';
    ELSE
        RAISE NOTICE 'Column last_name already exists';
    END IF;
END $$;

-- Step 3: Add experience_level column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'experience_level'
    ) THEN
        ALTER TABLE public.users 
        ADD COLUMN experience_level TEXT CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')) DEFAULT 'beginner';
        
        -- Update existing users to have default experience level
        UPDATE public.users 
        SET experience_level = 'beginner' 
        WHERE experience_level IS NULL;
        
        RAISE NOTICE '✅ Added experience_level column to public.users';
    ELSE
        RAISE NOTICE 'Column experience_level already exists';
    END IF;
END $$;

-- Step 4: Create/Replace the handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Create user profile in public.users when auth user is created
    INSERT INTO public.users (id, first_name, last_name, age, email, experience_level, risk_level, is_verified, email_verified_at, created_at, updated_at)
    VALUES (
        NEW.id,
        COALESCE((NEW.raw_user_meta_data->>'first_name')::TEXT, NULL),
        COALESCE((NEW.raw_user_meta_data->>'last_name')::TEXT, NULL),
        COALESCE((NEW.raw_user_meta_data->>'age')::INTEGER, NULL),
        NEW.email,
        COALESCE((NEW.raw_user_meta_data->>'experience_level')::experience_level_enum, 'beginner'),
        COALESCE((NEW.raw_user_meta_data->>'risk_level')::risk_level_enum, 'mid'),
        COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        NEW.email_confirmed_at,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        first_name = COALESCE(EXCLUDED.first_name, public.users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, public.users.last_name),
        age = COALESCE(EXCLUDED.age, public.users.age),
        email = COALESCE(EXCLUDED.email, public.users.email),
        experience_level = COALESCE(EXCLUDED.experience_level, public.users.experience_level),
        risk_level = COALESCE(EXCLUDED.risk_level, public.users.risk_level),
        is_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        email_verified_at = NEW.email_confirmed_at,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Create the trigger (drop if exists first)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Step 6: Create email verification trigger function (if not exists)
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

-- Step 7: Create email verification trigger
DROP TRIGGER IF EXISTS on_email_verified ON auth.users;

CREATE TRIGGER on_email_verified
    AFTER UPDATE OF email_confirmed_at ON auth.users
    FOR EACH ROW
    WHEN (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
    EXECUTE FUNCTION public.handle_email_verification();

-- Step 8: Sync existing users from auth.users to public.users
INSERT INTO public.users (id, email, first_name, last_name, experience_level, is_verified, email_verified_at, created_at, updated_at)
SELECT 
    au.id,
    au.email,
    COALESCE((au.raw_user_meta_data->>'first_name')::TEXT, NULL) as first_name,
    COALESCE((au.raw_user_meta_data->>'last_name')::TEXT, NULL) as last_name,
    COALESCE((au.raw_user_meta_data->>'experience_level')::TEXT, 'beginner')::TEXT as experience_level,
    COALESCE(au.email_confirmed_at IS NOT NULL, false) as is_verified,
    au.email_confirmed_at,
    au.created_at,
    NOW()
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    first_name = COALESCE(EXCLUDED.first_name, public.users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.users.last_name),
    experience_level = COALESCE(EXCLUDED.experience_level, public.users.experience_level),
    is_verified = COALESCE(EXCLUDED.is_verified, public.users.is_verified),
    email_verified_at = EXCLUDED.email_verified_at,
    updated_at = NOW();

-- Step 9: Verify the setup
SELECT 
    '✅ Setup Complete!' as status,
    (SELECT COUNT(*) FROM auth.users) as auth_users_count,
    (SELECT COUNT(*) FROM public.users) as public_users_count,
    (SELECT COUNT(*) FROM auth.users au LEFT JOIN public.users pu ON au.id = pu.id WHERE pu.id IS NULL) as missing_users_count;

-- Step 10: Show final table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'users'
ORDER BY ordinal_position;
