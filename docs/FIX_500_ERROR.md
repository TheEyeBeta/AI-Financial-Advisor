# Fix for 500 Internal Server Error on Signup

## The Problem

You're getting a 500 error because the database trigger function `handle_new_user` doesn't match the new schema (missing `age`, wrong `experience_level` type).

## The Solution

You have two options:

### Option 1: Run Migration Scripts (Recommended if you have existing data)

Run these migrations in order in your Supabase SQL Editor:

1. **`migration-add-name-experience.sql`** - Adds first_name, last_name, experience_level
2. **`migration-add-age-risk-level.sql`** - Adds age, risk_level, converts experience_level to ENUM

**Then update the trigger function:**

Run this in Supabase SQL Editor to update the trigger function:

```sql
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
```

### Option 2: Fresh Start (If you don't have important data)

Run the complete `supabase-schema.sql` file in Supabase SQL Editor. This will:
- Create all tables with the correct schema
- Create ENUM types
- Create the correct trigger function
- Set up all indexes and RLS policies

## After Running the Fix

1. Try signing up again
2. The error should be resolved
3. Users will be created with the correct schema (first_name, last_name, age, email, experience_level, risk_level)

## How to Access Supabase SQL Editor

1. Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new
2. Paste the SQL code
3. Click "Run" (or press Ctrl+Enter)
4. Wait for success message
