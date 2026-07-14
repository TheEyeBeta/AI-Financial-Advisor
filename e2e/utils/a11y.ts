import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

/**
 * Run axe (WCAG 2.0/2.1 A+AA) and fail on serious/critical violations (#213).
 * Call this at points where real page content is visible — scanning loading
 * skeletons passes trivially and proves nothing.
 */
export async function expectNoBlockingViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact && BLOCKING_IMPACTS.has(violation.impact),
  );
  const summary = blocking
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} — ` +
        violation.nodes.slice(0, 3).map((node) => node.target.join(' ')).join(' | '),
    )
    .join('\n');

  expect(blocking, `Blocking a11y violations on ${context}:\n${summary}`).toHaveLength(0);
}
