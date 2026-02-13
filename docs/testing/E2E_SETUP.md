# E2E Setup (Playwright)

This repository includes Playwright E2E tests under `e2e/`.

## Local

1. Install dependencies:
   ```bash
   npm install
   ```
2. Install browser binaries:
   ```bash
   npx playwright install --with-deps chromium
   ```
3. Run E2E:
   ```bash
   npm run test:e2e
   ```

## CI requirements

- CI must allow package install access for npm packages (including `@playwright/test`).
- CI must install Playwright browsers before running tests.
- Use npm caching (`actions/setup-node` with `cache: npm`) to reduce flaky installs and speed up runs.

The GitHub Actions workflow `.github/workflows/e2e.yml` implements these requirements.
