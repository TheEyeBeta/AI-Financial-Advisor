/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_PYTHON_API_URL?: string;
  readonly VITE_WEBSEARCH_API_URL?: string;
  readonly VITE_ENABLE_LOCAL_BACKEND_MONITOR?: string;
  readonly VITE_GOOGLE_AUTH_ENABLED?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
