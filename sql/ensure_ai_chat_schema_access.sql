-- Ensure the Supabase API can serve ai.chats and ai.chat_messages safely.
-- Dashboard/API follow-up: confirm the project's exposed schemas include `ai`
-- in Project Settings → API → Exposed schemas.

GRANT USAGE ON SCHEMA ai TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai.chats TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE ai.chat_messages TO authenticated;

-- Optional read-only access for anon if your project expects it.
-- Leave commented unless your public app intentionally allows anonymous chat reads.
-- GRANT SELECT ON TABLE ai.chats TO anon;
-- GRANT SELECT ON TABLE ai.chat_messages TO anon;
