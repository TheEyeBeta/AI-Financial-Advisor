-- Allow admin users to read all chat data for the admin analytics panel.
--
-- Without these policies the admin frontend (which uses the authenticated
-- Supabase JS client) can only count rows that belong to the current user,
-- so the tiles always show 0.  Adding a permissive SELECT policy for admins
-- is safe because Postgres RLS ORs multiple SELECT policies together —
-- regular users are still restricted to their own rows by the existing
-- "Users can view own …" policies.

-- ai.chats
DROP POLICY IF EXISTS "Admins can view all chats" ON ai.chats;
CREATE POLICY "Admins can view all chats"
  ON ai.chats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM core.users
      WHERE auth_id = auth.uid()
        AND "userType" = 'Admin'
    )
  );

-- ai.chat_messages
DROP POLICY IF EXISTS "Admins can view all chat messages" ON ai.chat_messages;
CREATE POLICY "Admins can view all chat messages"
  ON ai.chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM core.users
      WHERE auth_id = auth.uid()
        AND "userType" = 'Admin'
    )
  );
