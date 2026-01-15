-- Simple Trigger Fix (Minimal Version)
-- Use this if the complete fix doesn't work
-- This creates a minimal trigger that just inserts basic user data

-- Step 1: Drop existing trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Step 2: Create simple trigger function (minimal columns)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Try to insert with minimal required fields
    -- This works with both old and new structure
    INSERT INTO public.users (
        id,
        email,
        is_verified,
        email_verified_at,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,  -- Works for old structure (id = auth.id)
        NEW.email,
        COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        NEW.email_confirmed_at,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, public.users.email),
        is_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
        email_verified_at = NEW.email_confirmed_at,
        updated_at = NOW();
    
    -- Now try to update with metadata if columns exist
    -- This won't fail if columns don't exist
    BEGIN
        UPDATE public.users
        SET
            first_name = COALESCE((NEW.raw_user_meta_data->>'first_name')::TEXT, first_name),
            last_name = COALESCE((NEW.raw_user_meta_data->>'last_name')::TEXT, last_name),
            age = COALESCE((NEW.raw_user_meta_data->>'age')::INTEGER, age),
            experience_level = COALESCE(
                (NEW.raw_user_meta_data->>'experience_level')::experience_level_enum,
                experience_level,
                'beginner'::experience_level_enum
            ),
            risk_level = COALESCE(
                (NEW.raw_user_meta_data->>'risk_level')::risk_level_enum,
                risk_level,
                'mid'::risk_level_enum
            )
        WHERE id = NEW.id;
    EXCEPTION
        WHEN undefined_column THEN
            -- Column doesn't exist, that's okay
            NULL;
        WHEN OTHERS THEN
            -- Other error, log but don't fail
            RAISE WARNING 'Could not update metadata: %', SQLERRM;
    END;
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail auth user creation
        RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Create trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Step 4: Add RLS policy
DROP POLICY IF EXISTS "Service role can insert user profiles" ON public.users;

CREATE POLICY "Service role can insert user profiles" ON public.users
    FOR INSERT 
    WITH CHECK (true);

-- Success
SELECT '✅ Simple trigger created' AS status;
