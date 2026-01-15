-- COMPLETE DATABASE FIX for "Database error saving new user"
-- Run this script in Supabase SQL Editor to fix all schema issues
-- This script is idempotent (safe to run multiple times)

-- Step 1: Create ENUM types
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'experience_level_enum') THEN
        CREATE TYPE experience_level_enum AS ENUM ('beginner', 'intermediate', 'advanced');
        RAISE NOTICE '✅ Created experience_level_enum type';
    ELSE
        RAISE NOTICE 'experience_level_enum type already exists';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_level_enum') THEN
        CREATE TYPE risk_level_enum AS ENUM ('low', 'mid', 'high', 'very_high');
        RAISE NOTICE '✅ Created risk_level_enum type';
    ELSE
        RAISE NOTICE 'risk_level_enum type already exists';
    END IF;
END $$;

-- Step 2: Add first_name column if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'first_name'
    ) THEN
        ALTER TABLE public.users ADD COLUMN first_name TEXT;
        RAISE NOTICE '✅ Added first_name column';
    END IF;
END $$;

-- Step 3: Add last_name column if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'last_name'
    ) THEN
        ALTER TABLE public.users ADD COLUMN last_name TEXT;
        RAISE NOTICE '✅ Added last_name column';
    END IF;
END $$;

-- Step 4: Add age column if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'age'
    ) THEN
        ALTER TABLE public.users ADD COLUMN age INTEGER CHECK (age >= 13 AND age <= 150);
        RAISE NOTICE '✅ Added age column';
    END IF;
END $$;

-- Step 5: Remove password column if it exists (passwords belong in auth.users only)
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
    END IF;
END $$;

-- Step 6: Add experience_level column if missing, or convert to ENUM
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'experience_level'
    ) THEN
        -- Column doesn't exist, create it as ENUM
        ALTER TABLE public.users ADD COLUMN experience_level experience_level_enum DEFAULT 'beginner';
        UPDATE public.users SET experience_level = 'beginner' WHERE experience_level IS NULL;
        RAISE NOTICE '✅ Added experience_level column as ENUM';
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'experience_level'
        AND data_type = 'text'
    ) THEN
        -- Column exists as TEXT, convert to ENUM
        -- First drop the CHECK constraint if it exists
        ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_experience_level_check;
        
        -- Remove the default
        ALTER TABLE public.users ALTER COLUMN experience_level DROP DEFAULT;
        
        -- Convert type: cast text values to enum
        ALTER TABLE public.users 
        ALTER COLUMN experience_level TYPE experience_level_enum 
        USING CASE 
            WHEN experience_level = 'beginner' THEN 'beginner'::experience_level_enum
            WHEN experience_level = 'intermediate' THEN 'intermediate'::experience_level_enum
            WHEN experience_level = 'advanced' THEN 'advanced'::experience_level_enum
            ELSE 'beginner'::experience_level_enum
        END;
        
        -- Set default back as ENUM type
        ALTER TABLE public.users ALTER COLUMN experience_level SET DEFAULT 'beginner'::experience_level_enum;
        
        -- Update NULL values
        UPDATE public.users SET experience_level = 'beginner' WHERE experience_level IS NULL;
        
        RAISE NOTICE '✅ Converted experience_level to ENUM';
    END IF;
END $$;

-- Step 7: Add risk_level column if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'risk_level'
    ) THEN
        ALTER TABLE public.users ADD COLUMN risk_level risk_level_enum DEFAULT 'mid';
        UPDATE public.users SET risk_level = 'mid' WHERE risk_level IS NULL;
        RAISE NOTICE '✅ Added risk_level column';
    END IF;
END $$;

-- Step 8: Update the trigger function to match new schema
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

-- Step 9: Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Success message
SELECT '✅ Database fixed! All columns and trigger function updated.' AS status;
