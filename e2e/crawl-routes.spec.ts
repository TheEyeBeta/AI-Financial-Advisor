import { expect, test } from '@playwright/test';
import { installSupabaseMocks } from './utils/mock-supabase';
import { testUser } from './fixtures/test-user';
import { collectPageIssues, formatIssues, type PageIssue } from './utils/page-errors';

/**
 * Safe route crawler — visits each important route, collects errors.
 *
 * SAFETY RULES:
 * - Only visits GET routes (no form submissions)
 * - Clicks only visible, non-destructive UI elements (tabs, accordions)
 * - Never clicks: delete, publish, send, buy, sell, confirm, payment, email buttons
 * - Does not type into inputs
 * - Does not interact with modals that could trigger side effects
 *
 * LIMITATIONS:
 * - Cannot test routes that require real backend data (e.g., specific chat IDs)
 * - Mock data may cause empty-state rendering — that's expected
 * - Does not test authenticated admin routes (would need admin mock)
 * - Routes that hang on real API calls will be skipped after timeout
 */

const ROUTES = [
  { path: '/', name: 'Landing', protected: false },
  { path: '/dashboard', name: 'Dashboard', protected: true },
  { path: '/paper-trading', name: 'Paper Trading', protected: true },
  { path: '/news', name: 'News', protected: true },
  { path: '/top-stocks', name: 'Top Stocks', protected: true },
  { path: '/chat-history', name: 'Chat History', protected: true },
  { path: '/profile', name: 'Profile', protected: true },
  { path: '/academy', name: 'Academy', protected: true },
  // /advisor last — it may hang on real WebSocket/API calls
  { path: '/advisor', name: 'AI Advisor', protected: true },
];

// Buttons/links whose text matches these patterns are never clicked
const DESTRUCTIVE_PATTERNS = /delete|remove|publish|send|buy|sell|confirm|payment|pay|email|submit|logout|sign out|cancel subscription/i;

const ROUTE_TIMEOUT = 20_000;

async function signIn(page: import('@playwright/test').Page) {
  await installSupabaseMocks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  await page.getByLabel('Email').fill(testUser.email);
  await page.getByLabel('Password').fill(testUser.password);
  await page
    .getByRole('button', { name: /sign in/i })
    .filter({ hasText: /sign in/i })
    .last()
    .click();
  await page.waitForURL(/\/(advisor|onboarding|dashboard)/, { timeout: 10_000 });
}

test.describe('Route Crawler: safe exploration of key routes', () => {
  // Give the crawler enough total time for all routes
  test.setTimeout(180_000);

  test('visit all routes and report errors', async ({ page }) => {
    const allIssues: { route: string; issues: PageIssue[] }[] = [];
    const skipped: string[] = [];

    await signIn(page);

    for (const route of ROUTES) {
      const issues = collectPageIssues(page);

      try {
        await page.goto(route.path, { waitUntil: 'commit', timeout: ROUTE_TIMEOUT });
        // Give React time to render
        await page.waitForTimeout(2_000);
      } catch {
        skipped.push(`${route.name} (${route.path}) — navigation timeout`);
        continue;
      }

      // Try clicking non-destructive tab elements if present
      try {
        const tabs = page.getByRole('tab');
        const tabCount = await tabs.count();
        for (let i = 0; i < Math.min(tabCount, 5); i++) {
          const tab = tabs.nth(i);
          const text = await tab.textContent().catch(() => '');
          if (text && DESTRUCTIVE_PATTERNS.test(text)) continue;
          if (await tab.isVisible().catch(() => false)) {
            await tab.click({ timeout: 3_000 }).catch(() => {});
            await page.waitForTimeout(500);
          }
        }
      } catch {
        // Tab interaction failed — not critical
      }

      if (issues.length > 0) {
        allIssues.push({ route: `${route.name} (${route.path})`, issues });
      }
    }

    // Report all issues and skipped routes
    const sections: string[] = [];
    if (skipped.length > 0) {
      sections.push(`\nSkipped routes (timeout):\n${skipped.map((s) => `  - ${s}`).join('\n')}`);
    }
    if (allIssues.length > 0) {
      sections.push(
        allIssues
          .map((r) => `\n${r.route}:\n${formatIssues(r.issues)}`)
          .join('\n'),
      );
    }
    if (sections.length > 0) {
      console.log(`\n=== Route Crawler Report ===${sections.join('\n')}\n`);
    }

    // Fail only on uncaught page errors (not console warnings or expected 404s)
    const criticalIssues = allIssues.flatMap((r) =>
      r.issues.filter((i) => i.type === 'page-error'),
    );
    expect(
      criticalIssues,
      `Critical page errors found:\n${formatIssues(criticalIssues)}`,
    ).toHaveLength(0);
  });
});
