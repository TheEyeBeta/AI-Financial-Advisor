import type { Page } from '@playwright/test';

export interface PageIssue {
  type: 'console-error' | 'page-error' | 'failed-request';
  message: string;
  url?: string;
}

/**
 * Attaches listeners to a Playwright Page that collect:
 * - Uncaught page errors (window.onerror / unhandledrejection)
 * - Console errors (console.error)
 * - Failed network requests (status >= 400, excluding expected 401s on auth endpoints)
 *
 * Usage:
 *   const issues = collectPageIssues(page);
 *   // ... run test actions ...
 *   expect(issues).toEqual([]);
 */
export function collectPageIssues(page: Page): PageIssue[] {
  const issues: PageIssue[] = [];

  page.on('pageerror', (error) => {
    issues.push({
      type: 'page-error',
      message: error.message,
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore noisy but harmless browser warnings
      if (text.includes('Failed to load resource') && text.includes('favicon')) return;
      issues.push({
        type: 'console-error',
        message: text,
      });
    }
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    // Only flag true failures — skip auth challenge responses and CORS preflights
    if (status >= 400 && !url.includes('/auth/v1/') && status !== 401) {
      issues.push({
        type: 'failed-request',
        message: `${status} ${response.request().method()} ${url}`,
        url,
      });
    }
  });

  return issues;
}

/**
 * Formats collected issues for readable test output.
 */
export function formatIssues(issues: PageIssue[]): string {
  if (issues.length === 0) return 'No issues detected.';
  return issues
    .map((i, idx) => `  [${idx + 1}] ${i.type}: ${i.message}`)
    .join('\n');
}
