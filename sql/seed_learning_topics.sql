-- ============================================================
-- Seed Learning Topics for Testing
-- ============================================================
-- This creates some initial learning topics for testing purposes
-- Replace 'YOUR_USER_ID' with an actual user_id from your users table
-- ============================================================

-- Example: Get your user_id first
-- SELECT id FROM core.users WHERE auth_id = auth.uid();

-- Insert sample learning topics (replace YOUR_USER_ID with actual user_id)
-- You can run this in Supabase SQL Editor after getting your user_id

-- Example topics based on the curriculum
INSERT INTO public.learning_topics (user_id, topic_name, progress, completed)
VALUES
  -- Replace 'YOUR_USER_ID' with your actual user_id UUID
  ('YOUR_USER_ID', 'What Does Finance Actually Do?', 0, false),
  ('YOUR_USER_ID', 'Time is Money: The Power of Compounding', 0, false),
  ('YOUR_USER_ID', 'The Big 4 Asset Classes', 0, false),
  ('YOUR_USER_ID', 'Risk vs. Return: The Golden Rule', 0, false),
  ('YOUR_USER_ID', 'Diversification: Don''t Put All Eggs in One Basket', 0, false),
  ('YOUR_USER_ID', 'Stocks 101: Owning a Piece of a Company', 0, false),
  ('YOUR_USER_ID', 'Bonds 101: Lending Your Money', 0, false),
  ('YOUR_USER_ID', 'Funds, ETFs & Managed Products', 0, false)
ON CONFLICT (user_id, topic_name) DO NOTHING;

-- To get your user_id, run this first:
-- SELECT id, first_name, email FROM core.users WHERE auth_id = auth.uid();

-- Then replace 'YOUR_USER_ID' above with the id from the query result
