import { describe, expect, it } from 'vitest';
import {
  assertFrontendRuntimeConfigForProduction,
  getPythonApiUrl,
  getSupabaseEnvConfig,
  getWebSearchApiUrl,
  shouldMonitorBackendHealth,
} from '../env';

function createEnv(overrides: Record<string, string | boolean | undefined> = {}) {
  return {
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
    VITE_PYTHON_API_URL: '',
    VITE_WEBSEARCH_API_URL: '',
    PROD: false,
    ...overrides,
  };
}

describe('getSupabaseEnvConfig', () => {
  it('marks config as valid with real values', () => {
    const config = getSupabaseEnvConfig(
      createEnv({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'real-anon-key',
      }),
    );

    expect(config.isConfigured).toBe(true);
  });

  it('marks config as invalid for placeholder values', () => {
    const config = getSupabaseEnvConfig(
      createEnv({
        VITE_SUPABASE_URL: 'your_supabase_project_url',
        VITE_SUPABASE_ANON_KEY: 'your_supabase_anon_key',
      }),
    );

    expect(config.isConfigured).toBe(false);
  });

  it('marks config as invalid for malformed URLs', () => {
    const config = getSupabaseEnvConfig(
      createEnv({
        VITE_SUPABASE_URL: 'not-a-url',
        VITE_SUPABASE_ANON_KEY: 'some-key',
      }),
    );

    expect(config.isConfigured).toBe(false);
  });
});

describe('getPythonApiUrl', () => {
  it('falls back to localhost in development', () => {
    expect(getPythonApiUrl(createEnv())).toBe('http://localhost:8000');
  });

  it('throws in production when missing', () => {
    expect(() => getPythonApiUrl(createEnv({ PROD: true }))).toThrow(
      'VITE_PYTHON_API_URL must be configured with a real backend URL in production.',
    );
  });

  it('throws in production when pointing to localhost', () => {
    expect(() =>
      getPythonApiUrl(createEnv({ PROD: true, VITE_PYTHON_API_URL: 'http://localhost:8000' })),
    ).toThrow('VITE_PYTHON_API_URL must not point to localhost in production.');
  });
});

describe('getWebSearchApiUrl', () => {
  it('falls back to the Python API URL when unset', () => {
    expect(
      getWebSearchApiUrl(createEnv({ VITE_PYTHON_API_URL: 'https://backend.example.com' })),
    ).toBe('https://backend.example.com');
  });
});

describe('shouldMonitorBackendHealth', () => {
  it('does not enable monitoring for the development localhost fallback alone', () => {
    expect(shouldMonitorBackendHealth(createEnv())).toBe(false);
  });

  it('does not enable monitoring in development for an explicitly local backend by default', () => {
    expect(
      shouldMonitorBackendHealth(createEnv({ VITE_PYTHON_API_URL: 'http://localhost:8000' })),
    ).toBe(false);
  });

  it('enables monitoring in development when a non-local backend URL is configured', () => {
    expect(
      shouldMonitorBackendHealth(createEnv({ VITE_PYTHON_API_URL: 'https://backend.example.com' })),
    ).toBe(true);
  });

  it('allows explicitly opting into local backend monitoring in development', () => {
    expect(
      shouldMonitorBackendHealth(
        createEnv({
          VITE_PYTHON_API_URL: 'http://localhost:8000',
          VITE_ENABLE_LOCAL_BACKEND_MONITOR: 'true',
        }),
      ),
    ).toBe(true);
  });

  it('always enables monitoring in production', () => {
    expect(shouldMonitorBackendHealth(createEnv({ PROD: true }))).toBe(true);
  });
});

describe('assertFrontendRuntimeConfigForProduction', () => {
  it('passes with valid production config', () => {
    expect(() =>
      assertFrontendRuntimeConfigForProduction(
        createEnv({
          PROD: true,
          VITE_SUPABASE_URL: 'https://example.supabase.co',
          VITE_SUPABASE_ANON_KEY: 'real-anon-key',
          VITE_PYTHON_API_URL: 'https://backend.example.com',
          VITE_WEBSEARCH_API_URL: 'https://search.example.com',
        }),
      ),
    ).not.toThrow();
  });
});
