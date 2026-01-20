-- Add onboarding_complete column to users table
-- Run this in Supabase SQL Editor

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE;

-- Update existing users to have completed onboarding (so they don't get stuck)
UPDATE public.users 
SET onboarding_complete = TRUE 
WHERE onboarding_complete IS NULL;

-- Verify the column was added
SELECT 
    '✅ Onboarding column added' AS status,
    COUNT(*) FILTER (WHERE onboarding_complete = FALSE) AS users_needing_onboarding,
    COUNT(*) FILTER (WHERE onboarding_complete = TRUE) AS users_completed_onboarding
FROM public.users;
