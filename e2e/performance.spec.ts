/**
 * Lightweight performance and degraded-network release checks (#213).
 *
 * Budgets are deliberately generous — the CI server runs Vite (dev/preview)
 * on shared runners, so these catch order-of-magnitude regressions (a hung
 * request, an accidental multi-megabyte import, a render loop), not
 * micro-regressions. Bundle-size budgets are enforced separately against the
 * production build by scripts/check-bundle-budget.mjs. Budget table:
 * docs/tests/BETA_SUPPORT_MATRIX.md.
 */
import { expect, test } from '@playwright/test';

// CI shared runners are slow and dev-mode Vite serves unbundled modules.
const LANDING_DCL_BUDGET_MS = 15_000;
const ROUTE_TRANSITION_BUDGET_MS = 15_000;
const SLOW_NETWORK_FIRST_RENDER_BUDGET_MS = 60_000;

test.describe('Performance budgets', () => {
  test('landing page reaches DOMContentLoaded within budget', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const timing = await page.evaluate(() => {
      const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      return {
        domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
      };
    });

    expect(timing.domContentLoaded, 'DOMContentLoaded (ms)').toBeLessThan(LANDING_DCL_BUDGET_MS);
  });

  test('landing → privacy route renders within budget', async ({ page }) => {
    // Authed routes render skeletons under the browser-level mocks (their
    // budgets are checked against staging — see BETA_SUPPORT_MATRIX.md), so
    // the automated route budget uses a guaranteed-content route.
    await page.goto('/', { waitUntil: 'networkidle' });

    const start = Date.now();
    await page.getByRole('link', { name: /privacy policy/i }).click();
    await page.waitForURL(/\/privacy/);
    await expect(page.getByText(/privacy/i).first()).toBeVisible({
      timeout: ROUTE_TRANSITION_BUDGET_MS,
    });
    const elapsed = Date.now() - start;

    expect(elapsed, 'Route transition landing → privacy (ms)').toBeLessThan(
      ROUTE_TRANSITION_BUDGET_MS,
    );
  });
});

test.describe('Degraded network', () => {
  test('landing still renders on a slow connection', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP network throttling is Chromium-only');
    test.setTimeout(90_000);

    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    // Roughly "Fast 3G": 150ms RTT, ~1.6Mbps down. (Slow-3G is unrealistic
    // against Vite's unbundled dev serving in CI; real slow-network numbers
    // are checked against staging builds — see BETA_SUPPORT_MATRIX.md.)
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });

    const start = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: SLOW_NETWORK_FIRST_RENDER_BUDGET_MS });
    await expect(page.locator('body')).not.toBeEmpty();
    expect(Date.now() - start).toBeLessThan(SLOW_NETWORK_FIRST_RENDER_BUDGET_MS);
  });

  test('backend outage shows the app shell, not a blank page', async ({ page }) => {
    // Fail every backend/API call; the SPA must still render.
    await page.route('**/api/**', (route) => route.abort('connectionrefused'));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({ timeout: 15_000 });
  });
});
