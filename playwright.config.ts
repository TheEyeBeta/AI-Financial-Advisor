import { defineConfig, devices } from '@playwright/test';

/**
 * In CI the smoke E2E tests mock every Supabase / backend call at the browser
 * level (see e2e/utils/mock-supabase.ts), so only the Vite dev-server is
 * needed.  The Python backend requires a local venv + API keys that are not
 * available in CI, so we skip it there.
 */
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const useExternalBaseUrl = Boolean(externalBaseUrl);

const backendServer = process.env.CI || useExternalBaseUrl
  ? []
  : [
      {
        command: 'bash scripts/start-backend.sh',
        url: 'http://localhost:7000/health',
        timeout: 120 * 1000,
        reuseExistingServer: true as const,
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
      },
    ];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: externalBaseUrl ?? (process.env.CI ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:8080'),
    // Always capture traces for local debugging of schema/data failures
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Reasonable timeouts for local dev
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    ...backendServer,
    ...(useExternalBaseUrl
      ? []
      : [
          {
            command: process.env.CI
              ? 'npm run dev -- --host 0.0.0.0 --port 4173'
              : 'npm run dev -- --host 0.0.0.0 --port 8080',
            url: process.env.CI ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:8080',
            reuseExistingServer: !process.env.CI,
            env: {
              ...process.env,
              ...(process.env.CI
                ? { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'e2e-test-key' }
                : {}),
            },
          },
        ]),
  ],
  // Store all test artifacts (traces, screenshots, videos) in one place
  outputDir: './test-results',
});
