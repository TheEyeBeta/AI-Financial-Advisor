# Beta support matrix and quality release checks

**Owner:** TheEyeBeta · **Last verified:** 2026-07-13 · **Scope:** issue #213 (audit M-11)

## Supported browsers/devices for the 150-user beta

| Tier | Environment | Automated coverage |
|------|-------------|--------------------|
| Blocking | Desktop Chromium (Chrome/Edge, last 2 versions) | Full Playwright suite (`chromium` project) |
| Blocking | Mobile Chromium (Android, Pixel-7-class viewport) | Critical suite (`mobile-chromium` project) |
| Blocking | Desktop Firefox (last 2 versions) | Critical suite (`firefox` project) |
| Best-effort | Safari / WebKit desktop + iOS | Manual spot-checks before launch; not CI-blocking (no WebKit project yet — add one before admitting iOS-heavy cohorts) |

**Critical suite** = `smoke-landing.spec.ts` + `journeys/**` (auth, onboarding,
advisor, academy, paper trading, Google auth) + `a11y.spec.ts`. The `chromium`
project additionally runs route crawling, dashboards, and `performance.spec.ts`.

## Accessibility gates (automated)

- `e2e/a11y.spec.ts` runs axe (WCAG 2.0/2.1 A+AA rulesets) on: landing,
  privacy/terms, the sign-in dialog, advisor, academy, paper trading, chat
  history, and dashboard. **Serious/critical violations fail CI.**
- Keyboard: sign-in must be reachable/operable with Tab+Enter, dialog focus
  containment and Escape-to-close are asserted.
- Zoom/responsive: no horizontal page scrolling at 200%-zoom-equivalent
  (640px) and 360px mobile viewports.

## Manual acceptance checklist (run per release candidate)

- [ ] Complete each blocking journey with keyboard only (no pointer).
- [ ] VoiceOver/NVDA pass on landing + advisor: interactive controls announce
      role and name; chat messages are read in order.
- [ ] 200% browser zoom: onboarding, advisor composer, and paper-trade form
      remain fully usable (no clipped controls).
- [ ] `prefers-reduced-motion`: no essential information conveyed only by
      animation; carousels/streams remain readable.
- [ ] Color contrast spot-check on any new UI (axe covers programmatic
      contrast, verify brand overrides manually).
- [ ] iOS Safari spot-check of the blocking journeys (best-effort tier).

## Performance budgets

| Check | Budget | Where enforced |
|-------|--------|----------------|
| Total production JS (gzip) | 700 KB | `npm run test:bundle-budget` in CI after build (`scripts/check-bundle-budget.mjs`); current ~530 KB |
| Largest single JS chunk (gzip) | 200 KB | same |
| Landing DOMContentLoaded (CI dev server) | 15 s | `e2e/performance.spec.ts` |
| Landing → privacy route transition | 15 s | `e2e/performance.spec.ts` (authed-route budgets are staging checks — browser-level mocks render skeletons) |
| Landing first render on ~Fast-3G throttle | 60 s | `e2e/performance.spec.ts` (Chromium CDP; Slow-3G is unrealistic against unbundled dev serving) |
| Backend outage | App shell still renders (no blank page) | `e2e/performance.spec.ts` |

CI budgets are intentionally loose (shared runners, unbundled dev serving) —
they catch order-of-magnitude regressions. Real-user budgets for the beta
(LCP < 3 s on mid-range mobile over 4G against staging) are checked manually
per release until a staging Lighthouse job exists.

## Raising a budget

Budgets are release gates. Raise one only in a PR that explains the cause and
the user impact, reviewed by the repo owner — never to “make CI green.”
