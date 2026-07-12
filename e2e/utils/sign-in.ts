import { expect, type Page } from '@playwright/test';
import { testUser } from '../fixtures/test-user';
import { installSupabaseMocks } from './mock-supabase';

export async function signInWithMockedUser(
  page: Page,
  options?: { onboardingComplete?: boolean },
): Promise<void> {
  await installSupabaseMocks(page, options);

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: /^sign in$/i }).first().click();

  const dialog = page.getByRole('dialog', { name: /sign in/i });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });

  await dialog.locator('#signin-email').fill(testUser.email);
  await dialog.locator('#signin-password').fill(testUser.password);
  await dialog.locator('form button[type="submit"]').click();

  const destination =
    options?.onboardingComplete === false
      ? /\/onboarding/
      : /\/(advisor|onboarding|dashboard)/;
  await page.waitForURL(destination, { timeout: 15_000 });
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}
