import { expect, test } from '@playwright/test';
import { collectPageIssues, formatIssues } from './utils/page-errors';

test.describe('Smoke: Landing page', () => {
  test('loads without crashes', async ({ page }) => {
    const issues = collectPageIssues(page);

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Page renders something visible
    await expect(page.locator('body')).not.toBeEmpty();

    // No uncaught errors or failed requests
    const errors = issues.filter((i) => i.type === 'page-error');
    expect(errors, `Page errors:\n${formatIssues(errors)}`).toHaveLength(0);
  });

  test('sign-in button is visible', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('button', { name: /sign in/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
