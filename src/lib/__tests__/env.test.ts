import { afterEach, describe, expect, it } from 'vitest';
import { getSupabaseEnvConfig } from '../env';

const originalSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const originalSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

afterEach(() => {
  import.meta.env.VITE_SUPABASE_URL = originalSupabaseUrl;
  import.meta.env.VITE_SUPABASE_ANON_KEY = originalSupabaseAnonKey;
});

describe('getSupabaseEnvConfig', () => {
  it('marks config as valid with real values', () => {
    import.meta.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'real-anon-key';

    const config = getSupabaseEnvConfig();

    expect(config.isConfigured).toBe(true);
  });

  it('marks config as invalid for placeholder values', () => {
    import.meta.env.VITE_SUPABASE_URL = 'your_supabase_project_url';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'your_supabase_anon_key';

    const config = getSupabaseEnvConfig();

    expect(config.isConfigured).toBe(false);
  });

  it('marks config as invalid for malformed URLs', () => {
    import.meta.env.VITE_SUPABASE_URL = 'not-a-url';
    import.meta.env.VITE_SUPABASE_ANON_KEY = 'some-key';

    const config = getSupabaseEnvConfig();

    expect(config.isConfigured).toBe(false);
  });
});
