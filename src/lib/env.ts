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

const PYTHON_API_URL_PLACEHOLDERS = new Set([
  '',
  'http://your-trade-engine-server:8000',
  'https://your-backend.railway.app',
  'https://your-websearch-service.example.com',
]);

const LOCAL_BACKEND_URL = 'http://localhost:7000';

export interface FrontendRuntimeEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_PYTHON_API_URL?: string;
  VITE_WEBSEARCH_API_URL?: string;
  VITE_ENABLE_LOCAL_BACKEND_MONITOR?: string | boolean;
  PROD?: boolean;
}

export interface SupabaseEnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  isConfigured: boolean;
}

function isValidHttpUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isLocalBackendUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function getTrimmedEnvValue(value?: string): string {
  return (value || '').trim();
}

function isConfiguredBackendUrl(url: string): boolean {
  return isValidHttpUrl(url) && !PYTHON_API_URL_PLACEHOLDERS.has(url);
}

export function hasConfiguredPythonApiUrl(env: FrontendRuntimeEnv = import.meta.env): boolean {
  return isConfiguredBackendUrl(getTrimmedEnvValue(env.VITE_PYTHON_API_URL));
}

export function hasConfiguredWebSearchApiUrl(env: FrontendRuntimeEnv = import.meta.env): boolean {
  return isConfiguredBackendUrl(getTrimmedEnvValue(env.VITE_WEBSEARCH_API_URL));
}

export function shouldMonitorBackendHealth(env: FrontendRuntimeEnv = import.meta.env): boolean {
  if (env.PROD) return true;

  const enableLocalMonitor = getTrimmedEnvValue(String(env.VITE_ENABLE_LOCAL_BACKEND_MONITOR ?? '')).toLowerCase() === 'true';

  const pythonApiUrl = getTrimmedEnvValue(env.VITE_PYTHON_API_URL);
  if (hasConfiguredPythonApiUrl(env) && !isLocalBackendUrl(pythonApiUrl)) {
    return true;
  }

  const webSearchApiUrl = getTrimmedEnvValue(env.VITE_WEBSEARCH_API_URL);
  if (hasConfiguredWebSearchApiUrl(env) && !isLocalBackendUrl(webSearchApiUrl)) {
    return true;
  }

  return enableLocalMonitor;
}

export function getSupabaseEnvConfig(env: FrontendRuntimeEnv = import.meta.env): SupabaseEnvConfig {
  const supabaseUrl = getTrimmedEnvValue(env.VITE_SUPABASE_URL);
  const supabaseAnonKey = getTrimmedEnvValue(env.VITE_SUPABASE_ANON_KEY);
  const isConfigured =
    isValidHttpUrl(supabaseUrl) &&
    !SUPABASE_URL_PLACEHOLDERS.has(supabaseUrl) &&
    !SUPABASE_KEY_PLACEHOLDERS.has(supabaseAnonKey);

  return {
    supabaseUrl,
    supabaseAnonKey,
    isConfigured,
  };
}

export function assertSupabaseConfigForProduction(
  config: SupabaseEnvConfig,
  env: FrontendRuntimeEnv = import.meta.env,
): void {
  if (!env.PROD) return;

  if (!config.isConfigured) {
    throw new Error(
      'Missing Supabase configuration in production. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to real values.'
    );
  }
}

export function getPythonApiUrl(env: FrontendRuntimeEnv = import.meta.env): string {
  const pythonApiUrl = getTrimmedEnvValue(env.VITE_PYTHON_API_URL);

  if (isConfiguredBackendUrl(pythonApiUrl)) {
    if (env.PROD && isLocalBackendUrl(pythonApiUrl)) {
      throw new Error('VITE_PYTHON_API_URL must not point to localhost in production.');
    }
    return pythonApiUrl;
  }

  if (env.PROD) {
    throw new Error('VITE_PYTHON_API_URL must be configured with a real backend URL in production.');
  }

  return LOCAL_BACKEND_URL;
}

export function getWebSearchApiUrl(env: FrontendRuntimeEnv = import.meta.env): string {
  const webSearchApiUrl = getTrimmedEnvValue(env.VITE_WEBSEARCH_API_URL);

  if (isConfiguredBackendUrl(webSearchApiUrl)) {
    if (env.PROD && isLocalBackendUrl(webSearchApiUrl)) {
      throw new Error('VITE_WEBSEARCH_API_URL must not point to localhost in production.');
    }
    return webSearchApiUrl;
  }

  return getPythonApiUrl(env);
}

export function getPythonWebSocketUrl(env: FrontendRuntimeEnv = import.meta.env): string {
  return getPythonApiUrl(env).replace(/^http/i, 'ws');
}

export function assertFrontendRuntimeConfigForProduction(
  env: FrontendRuntimeEnv = import.meta.env,
): void {
  assertSupabaseConfigForProduction(getSupabaseEnvConfig(env), env);

  if (!env.PROD) return;

  getPythonApiUrl(env);
  getWebSearchApiUrl(env);
}
