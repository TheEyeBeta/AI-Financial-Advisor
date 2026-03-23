/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, type Page } from '@playwright/test';
import { installSupabaseMocks } from '../utils/mock-supabase';
import { testUser } from './test-user';

/**
 * Fixture that provides a page with Supabase mocks installed and the user
 * automatically signed in. Use this for any test that needs authenticated state.
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await installSupabaseMocks(page);

    // Navigate and sign in
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Sign In' }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('button', { name: 'Sign In' }).click();

    await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
    await page.getByLabel('Email').fill(testUser.email);
    await page.getByLabel('Password').fill(testUser.password);
    await page
      .getByRole('button', { name: 'Sign In', exact: false })
      .filter({ hasText: /Sign In/i })
      .last()
      .click();

    // Wait for post-login navigation
    await page.waitForURL(/\/(advisor|onboarding|dashboard)/, { timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    await use(page);
  },
});

export { expect } from '@playwright/test';
export { testUser };
