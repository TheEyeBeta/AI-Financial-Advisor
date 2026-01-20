-- Create ENUM types for onboarding questions
CREATE TYPE marital_status_enum AS ENUM ('single', 'married', 'divorced', 'widowed', 'partnered');
CREATE TYPE investment_goal_enum AS ENUM ('retirement', 'wealth_building', 'income', 'education', 'major_purchase', 'other');

-- Add columns to users table
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS marital_status marital_status_enum,
ADD COLUMN IF NOT EXISTS investment_goal investment_goal_enum;
