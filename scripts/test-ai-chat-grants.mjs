/**
 * Test script to verify ai.chats / ai.chat_messages grants are working.
 *
 * Usage (requires your Supabase URL and anon key):
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_ANON_KEY=eyJ... \
 *   node scripts/test-ai-chat-grants.mjs
 *
 * Or paste this into your browser console on the running app:
 *
 *   const { supabase } = await import('/src/lib/supabase.ts')
 *   const ai = supabase.schema('ai')
 *   const r1 = await ai.from('chats').select('id').limit(1)
 *   console.log('chats:', r1.status, r1.error?.message ?? 'OK')
 *   const r2 = await ai.from('chat_messages').select('id').limit(1)
 *   console.log('chat_messages:', r2.status, r2.error?.message ?? 'OK')
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY env vars before running.');
  process.exit(1);
}

const supabase = createClient(url, key);
const ai = supabase.schema('ai');

async function check(label, query) {
  const { status, error } = await query;
  if (error) {
    const hint =
      status === 404
        ? '→ 404: grants still missing or schema not exposed'
        : status === 403
        ? '→ 403: permission denied (RLS or grant issue)'
        : `→ unexpected error`;
    console.error(`FAIL  ${label} (HTTP ${status}): ${error.message}  ${hint}`);
    return false;
  }
  console.log(`OK    ${label} (HTTP ${status})`);
  return true;
}

const results = await Promise.all([
  check('SELECT ai.chats',         ai.from('chats').select('id').limit(1)),
  check('SELECT ai.chat_messages', ai.from('chat_messages').select('id').limit(1)),
]);

if (results.every(Boolean)) {
  console.log('\n✓ Grants are working. The 404 should be resolved.');
} else {
  console.log('\n✗ One or more checks failed. Rerun sql/fix_ai_chat_grants.sql and retry.');
  process.exit(1);
}
