# Fix "Database error saving new user"

## The Problem

You're getting a "Database error saving new user" because:
1. The database schema doesn't have the new columns (`age`, `risk_level`) yet
2. The trigger function `handle_new_user` doesn't match the new schema
3. ENUM types might not exist

## ✅ Quick Fix (RECOMMENDED - Run This!)

Run this SQL script in your Supabase SQL Editor to fix everything:

**File:** `COMPLETE_DATABASE_FIX.sql`

This script will:
- ✅ Create ENUM types if missing
- ✅ Add all missing columns (first_name, last_name, age, experience_level, risk_level)
- ✅ Convert experience_level to ENUM if needed
- ✅ Update the trigger function to match the new schema
- ✅ Recreate the trigger

**Just run `COMPLETE_DATABASE_FIX.sql` - it handles everything!**

---

## Alternative: Step-by-Step Fix

If you prefer to do it step-by-step, you can use:

**File:** `fix-trigger-function.sql`

Or run these commands directly:

### Step 1: Check if you need to add columns first

Run this to see what columns are missing:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'users'
ORDER BY ordinal_position;
```

### Step 2: Run the migrations

If columns are missing, run these in order:

1. **`migration-add-name-experience.sql`** - Adds first_name, last_name, experience_level
2. **`migration-add-age-risk-level.sql`** - Adds age, risk_level, converts experience_level to ENUM

### Step 3: Update the trigger function

Run **`fix-trigger-function.sql`** to update the trigger function.

## Complete Fix Script

If you want to do everything at once, here's a complete script:

```sql
-- Create ENUM types
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'experience_level_enum') THEN
        CREATE TYPE experience_level_enum AS ENUM ('beginner', 'intermediate', 'advanced');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_level_enum') THEN
        CREATE TYPE risk_level_enum AS ENUM ('low', 'mid', 'high', 'very_high');
    END IF;
END $$;

-- Add age column if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'age'
    ) THEN
        ALTER TABLE public.users ADD COLUMN age INTEGER CHECK (age >= 13 AND age <= 150);
    END IF;
END $$;

-- Add risk_level column if missing
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
    END IF;
END $$;

-- Update trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
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

-- Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

SELECT '✅ Database fixed!' AS status;
```

## How to Access Supabase SQL Editor

1. Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new
2. Paste the SQL code above
3. Click "Run" (or press Ctrl+Enter)
4. Wait for success message
5. Try signing up again

## Check Logs

If it still doesn't work, check the Supabase logs:
- Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/logs
- Look for errors related to `handle_new_user` or INSERT into `public.users`
