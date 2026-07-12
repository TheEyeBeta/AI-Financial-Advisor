import { expect, test } from '@playwright/test';
import { installSupabaseMocks } from '../utils/mock-supabase';

test.describe('Google authentication UI', () => {
  test('sign-in dialog shows Google button and divider when enabled', async ({ page }) => {
    await installSupabaseMocks(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByText(/or continue with email/i)).toBeVisible();
    await expect(page.getByText(/welcome back to lens/i)).toBeVisible();
  });

  test('email/password path remains available in sign-up dialog', async ({ page }) => {
    await installSupabaseMocks(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByLabel(/first name/i)).toBeVisible();
    await expect(page.getByLabel(/last name/i)).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByLabel(/age/i)).toHaveCount(0);
  });

  test('mocked OAuth initialization redirects toward callback', async ({ page }) => {
    await installSupabaseMocks(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('button', { name: /continue with google/i }).click();
    await page.waitForURL(/\/auth\/callback/, { timeout: 10_000 });
  });

  test('mobile viewport authentication dialog smoke', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installSupabaseMocks(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/welcome back to lens/i)).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });
});
