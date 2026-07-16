/**
 * Automated accessibility checks (#213).
 *
 * Signed-out surfaces are scanned directly. Signed-in pages are scanned only
 * when real content is visible under the browser-level Supabase mocks —
 * a scan of a loading skeleton passes trivially, so pages that don't render
 * content in the mocked environment SKIP loudly instead of green-washing.
 * (The journey specs embed additional scans at their content-loaded points.)
 * Manual acceptance checklist: docs/tests/BETA_SUPPORT_MATRIX.md.
 */
import { expect, test } from '@playwright/test';
import { expectNoBlockingViolations } from './utils/a11y';
import { signInWithMockedUser } from './utils/sign-in';

test.describe('Accessibility: signed-out pages', () => {
  test('landing page has no serious/critical violations', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expectNoBlockingViolations(page, 'landing');
  });

  test('privacy and terms pages have no serious/critical violations', async ({ page }) => {
    await page.goto('/privacy', { waitUntil: 'networkidle' });
    await expectNoBlockingViolations(page, 'privacy');
    await page.goto('/terms', { waitUntil: 'networkidle' });
    await expectNoBlockingViolations(page, 'terms');
  });

  test('sign-in dialog has no serious/critical violations', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^sign in$/i }).first().click();
    await page.getByRole('dialog', { name: /sign in/i }).waitFor({ state: 'visible' });
    await expectNoBlockingViolations(page, 'sign-in dialog');
  });
});

test.describe('Accessibility: core signed-in pages', () => {
  const pages: Array<{ path: string; name: string; contentSignal: RegExp }> = [
    // Scoped to copy that only appears on the advisor page itself — a bare
    // "iris"/"advisor"/"ask" match is loose enough to false-positive on
    // Onboarding.tsx's unrelated "...so IRIS can personalise..." copy if a
    // mocked sign-in races onto /onboarding instead of /advisor, which
    // would make this test scan the wrong page instead of skipping.
    { path: '/advisor', name: 'advisor', contentSignal: /ask about markets|iris provides educational analysis/i },
    { path: '/academy', name: 'academy', contentSignal: /academy|lesson|tier/i },
    { path: '/paper-trading', name: 'paper trading', contentSignal: /symbol|trade|position/i },
    { path: '/chat-history', name: 'chat history', contentSignal: /conversation|history/i },
    { path: '/dashboard', name: 'dashboard', contentSignal: /portfolio|dashboard|market/i },
  ];

  for (const target of pages) {
    test(`${target.name} page has no serious/critical violations`, async ({ page }) => {
      await signInWithMockedUser(page);
      await page.goto(target.path, { waitUntil: 'networkidle' });

      // Only scan real content. If the mocked environment leaves this page on
      // a skeleton or bounces it to onboarding, skip visibly — do not let a
      // spinner-only DOM count as accessibility coverage.
      const hasContent = await page
        .getByText(target.contentSignal)
        .first()
        .isVisible({ timeout: 10_000 })
        .catch(() => false);
      test.skip(
        !hasContent,
        `${target.name} renders no scannable content under browser-level mocks — needs staging E2E or richer mocks`,
      );

      await expectNoBlockingViolations(page, target.name);
    });
  }
});

test.describe('Keyboard access', () => {
  test('sign-in is reachable and operable with keyboard only', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for the app to actually mount before driving keys — otherwise the
    // bounded Tab walk below can exhaust its budget against an empty <body>
    // while the Vite dev bundle is still loading (browser-scoped race: seen
    // reproducibly on chromium/mobile-chromium, not firefox).
    await expect(page.getByRole('button', { name: /^sign in$/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Tab until the sign-in button takes focus (bounded walk).
    let focusedSignIn = false;
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const focusedText = await page.evaluate(
        () => document.activeElement?.textContent?.trim().toLowerCase() ?? '',
      );
      if (focusedText === 'sign in') {
        focusedSignIn = true;
        break;
      }
    }
    expect(focusedSignIn, 'Sign in button must be reachable via Tab').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: /sign in/i })).toBeVisible();

    // The dialog must contain focus: tabbing stays inside it.
    await page.keyboard.press('Tab');
    const activeElementInDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog?.contains(document.activeElement) ?? false;
    });
    expect(activeElementInDialog, 'Focus must stay inside the sign-in dialog').toBe(true);

    // Escape closes the dialog (focus is not permanently trapped).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /sign in/i })).toBeHidden();
  });
});

test.describe('Zoom and viewport resilience', () => {
  test('landing page does not scroll horizontally at 200% zoom equivalent', async ({ page }) => {
    // 200% zoom on a 1280px display ≈ a 640px-wide CSS viewport.
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto('/', { waitUntil: 'networkidle' });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'Horizontal overflow (px) at 200% zoom').toBeLessThanOrEqual(1);
  });

  test('landing page does not scroll horizontally on a small mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/', { waitUntil: 'networkidle' });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'Horizontal overflow (px) on 360px viewport').toBeLessThanOrEqual(1);
  });
});
