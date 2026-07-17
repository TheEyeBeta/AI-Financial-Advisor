# Runbook: Elevated frontend errors

**Rehearsed:** NO

- **Trigger:** Sentry frontend error spike; users reporting blank sections/broken interactions with backend healthy.
- **Severity:** SEV-2 (core journey broken) / SEV-3 (contained widget).
- **User impact:** depends on component — error boundaries should contain blast radius.

## Immediate containment
1. Sentry: group by error + release (releases are SHA-tagged via `getReleaseSha`). New release = prime suspect → frontend rollback is cheap (`frontend-deploy-failure.md` §containment).
2. Reproduce in an incognito session on production — distinguishes user-state-specific from universal.

## Diagnostics
- Browser console on the affected route; network tab for failing API calls (if backend 4xx/5xx → `elevated-5xx.md` instead).
- Check for CSP violations (console `Refused to…` lines) — a CSP change can silently kill Supabase/Sentry/PostHog connections (`connect-src` list in `index.html`/`vercel.json`).
- Source maps in Sentry should resolve to `src/` frames; if not, the build is misconfigured.

## Dashboards / logs
Sentry frontend; Vercel deployment logs; PostHog (if enabled) for funnel impact.

## Recovery
Rollback the frontend deployment if release-correlated; otherwise fix-forward through the normal flow. For third-party outage (Sentry/PostHog SDK failing), the app must still run — telemetry is non-blocking by design; verify that held.

## Rollback
Vercel promote-previous (instant); `../readiness/ROLLBACK.md` §Frontend.

## Validation
Error rate at baseline; affected journey passes manually; `e2e` smoke against production URL if warranted.

## Communication
Per severity; screenshot-level specificity helps beta users know if they're affected.

## Post-incident
If an error boundary was missing (blank page instead of contained failure), add one; update journey matrix if a covered journey regressed.
