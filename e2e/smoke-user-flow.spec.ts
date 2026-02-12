import { expect, test } from '@playwright/test';
import { installSupabaseMocks } from './utils/mock-supabase';
import { testUser } from './fixtures/test-user';

test.describe('Smoke E2E: sign-in to core product surfaces', () => {
  test('user can sign in, open dashboard, advisor, and paper trading', async ({ page }) => {
    await installSupabaseMocks(page);

    await page.goto('/');

    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByLabel('Email').fill(testUser.email);
    await page.getByLabel('Password').fill(testUser.password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/\/advisor/);
    await expect(page.getByText(/AI Financial Advisor/i)).toBeVisible();
    await expect(page.getByPlaceholder('Message...')).toBeVisible();

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();

    await page.getByRole('link', { name: 'Paper Trading' }).click();
    await expect(page).toHaveURL(/\/paper-trading/);
    await expect(page.getByRole('heading', { name: 'Paper Trading' })).toBeVisible();

    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByRole('tab', { name: 'History', selected: true })).toBeVisible();
  });
});
