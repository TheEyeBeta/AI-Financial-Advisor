import { expect, test } from '@playwright/test';

test.describe('Smoke E2E: public landing flow', () => {
  test('landing page renders core CTA surfaces', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /AI Financial Advisor/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Get Started/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign In/i })).toBeVisible();
  });
});
