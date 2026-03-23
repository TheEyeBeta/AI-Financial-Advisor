import { expect, test } from '@playwright/test';
import { installSupabaseMocks } from './utils/mock-supabase';
import { testUser } from './fixtures/test-user';
import { collectPageIssues, formatIssues } from './utils/page-errors';

/**
 * Sign in via mock and navigate to a protected route.
 * Reusable across dashboard/trading/news smoke tests.
 */
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

test.describe('Smoke: Dashboard', () => {
  test('dashboard loads after sign-in', async ({ page }) => {
    const issues = collectPageIssues(page);
    await signIn(page);

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 10_000 });

    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(0);

    const errors = issues.filter((i) => i.type === 'page-error');
    expect(errors, `Page errors:\n${formatIssues(errors)}`).toHaveLength(0);
  });
});

test.describe('Smoke: Paper Trading', () => {
  test('paper trading page loads', async ({ page }) => {
    const issues = collectPageIssues(page);
    await signIn(page);

    await page.goto('/paper-trading', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForURL(/\/(paper-trading|onboarding)/, { timeout: 10_000 });

    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(0);

    const errors = issues.filter((i) => i.type === 'page-error');
    expect(errors, `Page errors:\n${formatIssues(errors)}`).toHaveLength(0);
  });
});

test.describe('Smoke: News', () => {
  test('news page loads', async ({ page }) => {
    const issues = collectPageIssues(page);
    await signIn(page);

    await page.goto('/news', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForURL(/\/(news|onboarding)/, { timeout: 10_000 });

    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(0);

    const errors = issues.filter((i) => i.type === 'page-error');
    expect(errors, `Page errors:\n${formatIssues(errors)}`).toHaveLength(0);
  });
});

test.describe('Smoke: Top Stocks', () => {
  test('top stocks page loads', async ({ page }) => {
    const issues = collectPageIssues(page);
    await signIn(page);

    await page.goto('/top-stocks', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForURL(/\/(top-stocks|onboarding)/, { timeout: 10_000 });

    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(0);

    const errors = issues.filter((i) => i.type === 'page-error');
    expect(errors, `Page errors:\n${formatIssues(errors)}`).toHaveLength(0);
  });
});
