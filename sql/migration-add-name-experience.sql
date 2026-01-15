-- Migration: Add first_name, last_name, and experience_level columns to public.users table
-- Run this if you already have the schema running to add the new columns
-- This is safe to run multiple times (idempotent)

-- Step 1: Remove old name column if it exists (migration from single name to first/last)
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
        RAISE NOTICE 'Migrated name column to first_name and last_name';
    ELSE
        RAISE NOTICE 'Column name does not exist (good, using first_name/last_name)';
    END IF;
END $$;

-- Step 2: Add first_name column
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
        
        RAISE NOTICE 'Added first_name column to public.users';
    ELSE
        RAISE NOTICE 'Column first_name already exists';
    END IF;
END $$;

-- Step 3: Add last_name column
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
        
        RAISE NOTICE 'Added last_name column to public.users';
    ELSE
        RAISE NOTICE 'Column last_name already exists';
    END IF;
END $$;

-- Step 2: Add experience_level column
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
        
        RAISE NOTICE 'Added experience_level column to public.users';
    ELSE
        RAISE NOTICE 'Column experience_level already exists';
    END IF;
END $$;

-- Success message
SELECT '✅ Migration completed successfully! Added first_name, last_name, and experience_level columns.' AS status;
