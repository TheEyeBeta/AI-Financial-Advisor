import { expect, test } from '@playwright/test';
import { installSupabaseMocks } from './utils/mock-supabase';
import { testUser } from './fixtures/test-user';

test.describe('Smoke E2E: sign-in to core product surfaces', () => {
  test('user can sign in, open dashboard, advisor, and paper trading', async ({ page }) => {
    await installSupabaseMocks(page);

    // Test 1: Sign in flow
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL('/');

    // Click Sign In
    await page.getByRole('button', { name: 'Sign In' }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    // Fill and submit sign in form
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    await page.getByLabel('Email').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByLabel('Email').fill(testUser.email);
    await page.getByLabel('Password').fill(testUser.password);
    await page.getByRole('button', { name: 'Sign In', exact: false }).filter({ hasText: /Sign In/i }).last().click();

    // Wait for navigation after sign in
    await page.waitForURL(/\/(advisor|onboarding)/, { timeout: 10000 });
    
    // Test 2: Verify advisor page loads (or onboarding if profile needs setup)
    const advisorUrl = page.url();
    expect(advisorUrl).toMatch(/\/(advisor|onboarding)/);
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    
    // Verify page has content
    const bodyContent = await page.textContent('body');
    expect(bodyContent).toBeTruthy();
    expect(bodyContent!.length).toBeGreaterThan(0);

    // Test 3: Navigate to dashboard (tests routing)
    await page.goto('/dashboard', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 10000 });
    const dashboardUrl = page.url();
    expect(dashboardUrl).toMatch(/\/(dashboard|onboarding)/);
    
    // Verify dashboard content loads
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    const dashboardContent = await page.textContent('body');
    expect(dashboardContent).toBeTruthy();

    // Test 4: Navigate to paper trading (tests routing)
    await page.goto('/paper-trading', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForURL(/\/(paper-trading|onboarding)/, { timeout: 10000 });
    const paperTradingUrl = page.url();
    expect(paperTradingUrl).toMatch(/\/(paper-trading|onboarding)/);
    
    // Verify paper trading content loads
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    const paperTradingContent = await page.textContent('body');
    expect(paperTradingContent).toBeTruthy();

    // Test 5: Try to interact with History tab if it exists (optional)
    const historyTab = page.getByRole('tab', { name: /History/i });
    const hasHistoryTab = await historyTab.isVisible().catch(() => false);
    
    if (hasHistoryTab) {
      await historyTab.click({ timeout: 5000 });
      await expect(page.getByRole('tab', { name: /History/i, selected: true })).toBeVisible({ timeout: 5000 });
    }
  });
});
