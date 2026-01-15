-- Migration: Add age and risk_level columns, convert experience_level to ENUM
-- Run this after migration-add-name-experience.sql
-- This is safe to run multiple times (idempotent)

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

-- Step 2: Convert experience_level from TEXT to ENUM
DO $$
BEGIN
    -- Check if column exists and is TEXT type
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'experience_level'
        AND data_type = 'text'
    ) THEN
        -- Convert existing TEXT values to ENUM
        ALTER TABLE public.users 
        ALTER COLUMN experience_level TYPE experience_level_enum 
        USING experience_level::experience_level_enum;
        
        RAISE NOTICE '✅ Converted experience_level to ENUM';
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'experience_level'
        AND udt_name = 'experience_level_enum'
    ) THEN
        RAISE NOTICE 'experience_level already is ENUM type';
    ELSE
        RAISE NOTICE 'experience_level column does not exist';
    END IF;
END $$;

-- Step 3: Add age column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'age'
    ) THEN
        ALTER TABLE public.users 
        ADD COLUMN age INTEGER CHECK (age >= 13 AND age <= 150);
        
        RAISE NOTICE '✅ Added age column to public.users';
    ELSE
        RAISE NOTICE 'Column age already exists';
    END IF;
END $$;

-- Step 4: Add risk_level column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'risk_level'
    ) THEN
        ALTER TABLE public.users 
        ADD COLUMN risk_level risk_level_enum DEFAULT 'mid';
        
        -- Update existing users to have default risk level
        UPDATE public.users 
        SET risk_level = 'mid' 
        WHERE risk_level IS NULL;
        
        RAISE NOTICE '✅ Added risk_level column to public.users';
    ELSE
        RAISE NOTICE 'Column risk_level already exists';
    END IF;
END $$;

-- Success message
SELECT '✅ Migration completed successfully! Added age and risk_level columns, converted experience_level to ENUM.' AS status;
