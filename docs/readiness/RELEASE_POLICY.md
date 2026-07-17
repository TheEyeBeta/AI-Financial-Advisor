# Release Policy — production promotion and exact-SHA enforcement

**Owner:** TheEyeBeta · **Created:** 2026-07-16 (Phase 1 of the 10/10 beta-readiness plan)
**Related:** [`docs/ci/CI_GUIDELINES.md`](../ci/CI_GUIDELINES.md) (pipeline inventory, branch-ruleset checklist),
[`docs/readiness/RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md) (per-release checklist),
[`docs/readiness/ROLLBACK.md`](./ROLLBACK.md) (rollback procedures).

The objective of this policy: **production cannot receive a release with a
known failed mandatory check**, and every deployed artifact is traceable to
an exact git SHA.

---

## 1. Promotion flow

```text
Feature branch
→ Pull request (to staging)
→ Required CI (all mandatory checks below)
→ Merge to staging
→ Staging deployment (Railway staging service + Vercel preview/staging)
→ Staging E2E (deploy-staging.yml "e2e" job against the live staging URL)
→ Release Verification (release-verification.yml — deployed SHA == expected SHA)
→ Manual approval ("Promote to Production" workflow opens staging → main PR;
   PR requires review + all mandatory checks)
→ Merge to main
→ Production deployment (Vercel + Railway native git integrations on main)
→ Production smoke test (release-verification.yml against production URLs
   + manual smoke per RELEASE_CHECKLIST.md)
```

Direct pushes to `main` are forbidden. The only supported path to `main` is
the staging → main promotion PR opened by `promote-to-prod.yml`.

**Deployment mechanism (verified 2026-07-16):** production deploys are
performed by the Vercel and Railway **native GitHub integrations** watching
`main` — the previous `deploy.yml` GitHub Actions deploy workflow was removed
in commit `5c08277` (2026-07-13). Consequences:

- GitHub cannot technically block the platform deploy on CI status unless the
  platform-side "wait for CI checks" options are enabled
  (`EXTERNAL ACCESS REQUIRED` — see §5).
- The enforceable gate is therefore **branch protection on `main`**: a commit
  can only reach `main` through a PR with all mandatory checks green.

## 2. Mandatory checks (production candidate)

These are the exact check-run names GitHub reports, reconciled against the
workflow files on 2026-07-16. Branch rulesets must reference the *job-level*
names in the left column.

| Mandatory check (job name) | Workflow (`name:`) | File |
| --- | --- | --- |
| `frontend` | CI/CD Pipeline | `ci.yml` |
| `backend` | CI/CD Pipeline | `ci.yml` |
| `docker-build` | CI/CD Pipeline | `ci.yml` (path-filtered — see caveat in CI_GUIDELINES §3.8) |
| `quality` | Lint & Type Check | `lint.yml` |
| `test` | E2E Tests | `e2e.yml` |
| `node-audit` | Security Checks | `security.yml` |
| `python-audit` | Security Checks | `security.yml` |
| `python-bandit` | Security Checks | `security.yml` |
| `secret-scan` | Security Checks | `security.yml` |
| `test-docker-build` | Docker Build and Test | `docker-build.yml` (path-filtered) |
| `backend-integration` | Backend Integration Tests | `integration-tests.yml` (push to main/staging) |
| `verify-staging` | Deploy Staging | `deploy-staging.yml` (staging branch only) |
| `e2e` (staging) | Deploy Staging | `deploy-staging.yml` (staging branch only) |
| `verify-release` | Release Verification | `release-verification.yml` (manual, post-deploy) |

Renaming any workflow or job in this table is a **breaking change to release
discipline**: update this file, `CI_GUIDELINES.md` §3.8, and the GitHub
ruleset in the same change, and say so in the PR description.

## 3. Exact release SHA — traceability mechanism

| Layer | Mechanism | Where |
| --- | --- | --- |
| Backend | `/health` and `/health/ready` return a `release` object: `git_sha` (`GIT_SHA` env, falling back to Railway-native `RAILWAY_GIT_COMMIT_SHA`), `app_version` (`APP_VERSION`), `build_timestamp` (`BUILD_TIMESTAMP`), `expected_schema_revision` (Alembic head shipped in the image), `environment` | `app/health_checks.py::release_info`, tests in `tests/test_health_checks.py` |
| Frontend | `<meta name="release-sha">` stamped into `index.html` at build time from `VITE_RELEASE_SHA` or `VITE_VERCEL_GIT_COMMIT_SHA`; also used as the Sentry `release` (`src/lib/telemetry.ts::getReleaseSha`) | `vite.config.ts` (`releaseShaMetaTag` plugin) |
| Database | `public.alembic_version` compared to the build's expected revision at readiness; mismatch ⇒ instance reports not-ready | `app/health_checks.py::_check_schema_revision` |
| Verification | `node scripts/verify-release.mjs --expected-sha <sha> --frontend <url> --backend <url>` — fails non-zero on any mismatch or when the deployment exposes no SHA | `scripts/verify-release.mjs`, `release-verification.yml` |

**Smoke rule:** a release is not "live" until `verify-release` has passed
against the deployed URLs with the promoted SHA. "The deploy dashboard says
success" is not evidence the right build is serving traffic.

## 4. Failed-check handling

- A failed mandatory check **blocks merge** via branch protection; there is
  no soft-fail path (`continue-on-error`, `|| true` and job-level skips are
  forbidden by `AGENTS.md` and reviewed in every workflow PR).
- A failed check on `staging` blocks promotion: `promote-to-prod.yml` opens a
  PR whose mandatory checks re-run; a red check leaves the PR unmergeable.
- Logs and artifacts are preserved by GitHub Actions retention (Playwright
  traces/reports are uploaded as artifacts in `e2e.yml` / `deploy-staging.yml`).
- Re-running a flaky job is permitted **once**; a second failure is treated
  as a real defect (CI_GUIDELINES §4).
- Nobody — including admins — may merge over a red mandatory check. This is
  only technically enforced once the ruleset in §5 is applied.

## 5. External configuration (not enforceable from this repository)

| Item | Instructions | Status |
| --- | --- | --- |
| Branch ruleset on `main` (require PR, 1 approval, dismiss stale approvals, resolved threads, up-to-date branch, mandatory checks from §2, block force-push/deletion, no admin bypass) | `docs/ci/CI_GUIDELINES.md` §3.8 (settings list + check-name table) | `EXTERNAL ACCESS REQUIRED` — not verifiable from the repo |
| Branch ruleset on `staging` (same, minus staging-only checks) | same checklist, target `staging` | `EXTERNAL ACCESS REQUIRED` |
| Vercel: expose system env vars (provides `VITE_VERCEL_GIT_COMMIT_SHA`) | Vercel project → Settings → Environment Variables → "Automatically expose System Environment Variables" | `EXTERNAL ACCESS REQUIRED` |
| Railway: confirm `RAILWAY_GIT_COMMIT_SHA` is present (or set `GIT_SHA`/`APP_VERSION`/`BUILD_TIMESTAMP`) on staging + production services | Railway service → Variables | `EXTERNAL ACCESS REQUIRED` |
| Vercel/Railway "wait for CI" deploy gating on `main`, if available on current plans | platform dashboards | `EXTERNAL ACCESS REQUIRED` |

Until each row above is confirmed by a human with dashboard access, treat the
corresponding guarantee as **documented but not enforced**, and say so in any
readiness claim.

## 6. Keyboard E2E gate (Phase 1 finding, fixed)

The reproducible `Keyboard access → sign-in is reachable and operable with
keyboard only` failure was investigated to root cause:

- **Root cause:** Radix `DialogContent` only restores focus to a
  `DialogTrigger`; every dialog in this app is controlled
  (`open`/`onOpenChange`) with no trigger, so Radix `preventDefault()`ed the
  FocusScope restore and focused a null `triggerRef` — keyboard focus fell to
  `<body>` on every dialog close (WCAG 2.4.3 failure), for all dialogs
  app-wide. (Category: "Radix dialog focus handling", not a brittle test.)
- **Fix:** `src/components/ui/dialog.tsx` captures the opener in
  `onOpenAutoFocus` and restores it in `onCloseAutoFocus` when still
  connected. Consumers that supply their own `onCloseAutoFocus` and call
  `preventDefault()` keep full control.
- **Regression tests:** unit — `src/components/ui/__tests__/dialog.test.tsx`;
  E2E — `e2e/a11y.spec.ts` now asserts all eight required behaviours
  (reachable, visible focus indicator, Enter *and* Space activation, focus
  entry, focus containment over a full Tab cycle, Escape close, focus
  restoration) and runs on chromium, mobile-chromium and firefox projects.
