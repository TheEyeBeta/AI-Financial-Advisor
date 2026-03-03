const SUPABASE_URL_PLACEHOLDERS = new Set([
  '',
  'your_supabase_project_url',
  'https://your-project.supabase.co',
  'https://your-project-id.supabase.co',
]);

const SUPABASE_KEY_PLACEHOLDERS = new Set([
  '',
  'your_supabase_anon_key',
  'your-anon-key',
]);

export interface SupabaseEnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  isConfigured: boolean;
}

function isValidHttpUrl(url: string): boolean {
  if (!url || SUPABASE_URL_PLACEHOLDERS.has(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getSupabaseEnvConfig(): SupabaseEnvConfig {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
  const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const isConfigured =
    isValidHttpUrl(supabaseUrl) && !SUPABASE_KEY_PLACEHOLDERS.has(supabaseAnonKey);

  return {
    supabaseUrl,
    supabaseAnonKey,
    isConfigured,
  };
}

export function assertSupabaseConfigForProduction(config: SupabaseEnvConfig): void {
  if (!import.meta.env.PROD) return;

  if (!config.isConfigured) {
    throw new Error(
      'Missing Supabase configuration in production. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to real values.'
    );
  }
}
