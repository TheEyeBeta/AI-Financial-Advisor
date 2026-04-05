import { supabase } from '@/lib/supabase';
import { getPythonApiUrl } from '@/lib/env';

/**
 * Fire-and-forget refresh of the IRIS AI context cache for a user.
 * Called after mutations that change data the AI reasons from
 * (trades, profile, goals, academy progress).
 *
 * Never throws — failures are logged and silently ignored so they
 * never block the user's primary action.
 */
export async function refreshIrisContextCache(userId: string): Promise<void> {
  try {
    const pythonApiUrl = getPythonApiUrl();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!pythonApiUrl || !token) return;

    await fetch(`${pythonApiUrl}/api/meridian/refresh-context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ user_id: userId }),
    });
  } catch {
    // Non-critical — IRIS will use stale cache until next refresh
  }
}
