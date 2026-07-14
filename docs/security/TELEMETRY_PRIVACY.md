# Telemetry privacy policy (Sentry)

**Owner:** TheEyeBeta · **Last verified:** 2026-07-13 · **Scope:** frontend error/trace telemetry (issue #204, audit M-02)

## What we send

Sentry is initialized from `src/lib/telemetry.ts` (used by `src/main.tsx`) only when
`VITE_SENTRY_DSN` is set. Every outgoing event — errors, transactions, and
breadcrumbs — passes through `redactSentryEvent` / `redactBreadcrumb` before
transmission. The policy is enforced by unit tests in
`src/lib/__tests__/telemetry.test.ts`.

| Data | Policy |
|------|--------|
| Default PII (IP, headers, cookies) | **Off** (`sendDefaultPii: false`; request headers/cookies/body/query dropped) |
| User identity | Pseudonymous Supabase UUID only; email/username/IP removed |
| URLs | Query strings and fragments stripped everywhere (request, breadcrumbs, transactions) |
| Prompts, messages, profile, portfolio, balances, income | Redacted by key-name matching in `extra`/`contexts`/`tags`/breadcrumb data |
| Tokens (JWT, `Bearer …`, provider API-key shapes), emails | Pattern-scrubbed out of all free-form strings |
| Console breadcrumbs | Dropped entirely |
| Session Replay / session capture | **Disabled** (`replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 0`, no replay integration). Do not enable without a privacy review against this document. |

## Sampling policy

- **Non-production** (`MODE !== "production"`): 100% traces, for debugging.
- **Production baseline:** 5% of transactions (`PRODUCTION_BASELINE_TRACE_RATE`).
- **Production critical routes** (`/advisor`, `/auth`, `/onboarding`, `/paper-trading`): 25%.
- Errors are not sampled away — all (redacted) error events are sent.

## Tagging

Events carry `environment` (Vite `MODE`) and `release` (`VITE_RELEASE_SHA`, falling
back to `VITE_VERCEL_GIT_COMMIT_SHA` when Vercel system env vars are exposed).
This satisfies the "release SHA visible in frontend telemetry" launch threshold in #216.

## Lawful purpose, retention, access, deletion

- **Purpose:** diagnosing application errors and performance regressions.
  Telemetry is not used for product analytics (PostHog handles that separately)
  or for profiling users.
- **Retention:** Sentry's default retention (90 days for events) applies; do not
  extend it without updating this document. Configure the retention window in the
  Sentry project settings (human/dashboard step — agents must not change it).
- **Access:** limited to the project maintainer(s) with Sentry project access.
- **Deletion:** a user-data deletion request is satisfied by deleting events for
  the pseudonymous user id via Sentry's user-deletion API
  (`https://docs.sentry.io/api/`), since the UUID is the only identifier stored.

## Privacy review checklist (run before changing telemetry)

- [ ] `sendDefaultPii` remains `false`.
- [ ] No replay/session-capture integration added without review.
- [ ] New event fields pass through `redactSentryEvent` and are covered by a test in `telemetry.test.ts`.
- [ ] No raw prompt, token, email, or financial value appears in a captured test event.
- [ ] Sampling changes update this document and the constants in `src/lib/telemetry.ts` together.
