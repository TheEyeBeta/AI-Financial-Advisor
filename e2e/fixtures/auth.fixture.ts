/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, type Page } from '@playwright/test';
import { signInWithMockedUser } from '../utils/sign-in';

/**
 * Fixture that provides a page with Supabase mocks installed and the user
 * automatically signed in. Use this for any test that needs authenticated state.
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await signInWithMockedUser(page);
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
export { testUser } from './test-user';
