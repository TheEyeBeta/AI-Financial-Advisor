# Runbook: Frontend deployment failure

**Rehearsed:** NO

- **Trigger:** Vercel deploy fails, or the deployed site is blank/erroring after a merge to `main`; `verify-release` frontend check fails.
- **Severity:** SEV-2 (SEV-3 if previous deployment still serving).
- **User impact:** app unreachable or serving a broken/stale build.

## Immediate containment
1. Vercel keeps the previous production deployment live on build failure — confirm which deployment is actually serving (Vercel dashboard → Deployments → Production).
2. If a *bad* build went live: Vercel → Deployments → previous good deployment → **Promote to Production** (instant rollback).

## Diagnostics
```bash
curl -sI https://<frontend>/                       # status + cache headers
curl -s https://<frontend>/ | grep -o '<meta name="release-sha"[^>]*>'
node scripts/verify-release.mjs --expected-sha <sha> --frontend https://<frontend> --allow-short
```
- Vercel build logs (dashboard → failing deployment → Build Logs); typical causes: missing `VITE_*` env var (`assertFrontendRuntimeConfigForProduction` fails fast with a visible config-error screen), dependency install failure, CSP/meta regression.

## Dashboards / logs
Vercel dashboard; Sentry (frontend project) for runtime errors; GitHub Actions `ci.yml#frontend` for the same commit.

## Recovery
1. Reproduce locally: `npm ci --ignore-scripts && npm run build` with production-shaped env.
2. Fix root cause on a branch → PR → normal promotion flow. Never hotfix by editing the Vercel deployment directly.

## Rollback
Promote previous good deployment (above); full procedure `../readiness/ROLLBACK.md` §Frontend.

## Validation
`verify-release` passes against the intended SHA; landing + sign-in dialog load; Sentry error rate back to baseline.

## Communication
SEV-2: status note to beta users only if downtime exceeded ~15 min (template in `../readiness/STAGED_LAUNCH.md` comms section).

## Post-incident
Issue with `incident` label; if cause was a missing env var, add it to the release checklist's environment-changes section.
