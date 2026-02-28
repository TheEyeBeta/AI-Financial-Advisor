import { defineConfig, devices } from '@playwright/test';

/**
 * In CI the smoke E2E tests mock every Supabase / backend call at the browser
 * level (see e2e/utils/mock-supabase.ts), so only the Vite dev-server is
 * needed.  The Python backend requires a local venv + API keys that are not
 * available in CI, so we skip it there.
 */
const backendServer = process.env.CI
  ? []
  : [
      {
        command: 'bash scripts/start-backend.sh',
        url: 'http://localhost:8000/health',
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
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    ...backendServer,
    {
      command:
        'VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=e2e-test-key npm run dev -- --host 0.0.0.0 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
