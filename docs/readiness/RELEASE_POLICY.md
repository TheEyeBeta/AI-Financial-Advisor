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
| Verification | `node scripts/verify-release.mjs --expected-sha <full-40-char-sha> --frontend <url> --backend <url> --allowed-hosts <host1,host2>` — fails non-zero on any mismatch, on a short/partial SHA, on a host outside the allowlist, or when the deployment exposes no SHA | `scripts/verify-release.mjs`, `scripts/lib/release-verify-core.mjs`, `release-verification.yml` |

**Smoke rule:** a release is not "live" until `verify-release` has passed
against the deployed URLs with the promoted SHA. "The deploy dashboard says
success" is not evidence the right build is serving traffic.

### 3.1 Verification is fail-closed by construction

`verify-release.mjs` (backed by `scripts/lib/release-verify-core.mjs`, unit
tested in `scripts/__tests__/verify-release.test.mjs`) enforces, and cannot
be made to skip:

- **Both components required.** A run given only a frontend URL or only a
  backend URL fails immediately with an explicit error — it never reports a
  pass having checked one artifact. This check lives solely in
  `scripts/verify-release.mjs`/`release-verify-core.mjs`; `release-verification.yml`
  does not duplicate it in bash, so there is nothing in the workflow to drift
  out of sync — it just passes `FRONTEND_URL`/`BACKEND_URL` through verbatim,
  even when empty, and lets the script's fail-closed evidence-producing path
  handle it.
- **Full SHA only, lowercase.** `--expected-sha` must match `^[0-9a-f]{40}$`
  exactly. There is no short/prefix-match mode and no case-insensitive
  fallback (the previous `--allow-short` flag has been removed from the
  script, the workflow, and this document — Vercel and Railway are both
  configured to expose the full SHA, so there is no legitimate reason to
  accept a truncated or uppercase one).
- **Strict URL parsing.** Every target URL is parsed with the platform `URL`
  class and rejected if it is not `https:`, has no hostname, embeds
  credentials (`user:pass@host`), or contains a fragment (`#...`). A
  rejected URL's credentials/query/fragment are never echoed into error
  messages, logs, or the evidence file — only the sanitized
  scheme+host+path is ever displayed.
- **Explicit host allowlist.** Each URL's hostname must appear in the
  `--allowed-hosts` list (workflow: `vars.RELEASE_ALLOWED_HOSTS`, a
  comma-separated list of approved staging/production Vercel and Railway
  hostnames). There is no default allowlist and no substring/heuristic check
  (e.g. matching on the literal word "production") — an unconfigured
  allowlist fails the run rather than silently accepting any host.
- **No off-host or off-HTTPS redirects.** If the fetch is redirected to a
  different hostname than the one that was validated against the allowlist,
  or downgraded from HTTPS to HTTP on the same host, the check fails — a
  redirect cannot be used to serve a different deployment's answer, or a
  plaintext one, for an approved URL.
- **Bounded fetches.** Each frontend/backend fetch carries a 10-second
  timeout (`DEFAULT_FETCH_TIMEOUT_MS` in `release-verify-core.mjs`); an
  unresponsive target fails the check with clear evidence instead of hanging
  the release gate.
- **All four backend release fields required.** `release.git_sha`,
  `release.app_version`, `release.expected_schema_revision`, and
  `release.environment` must all be present in `/health`; any missing field
  fails the backend check.
- **`app_version` must equal the expected SHA unless mapped.** By default the
  backend's `app_version` must equal `--expected-sha` exactly (SHA-as-version
  is the default scheme in this repo). A project that wants semantic version
  strings instead may pass `--version-map <path-to-json>`, a
  `{ "<full-sha>": "<app_version>" }` mapping checked into the repo and
  reviewed like any other release artifact — there is no way to relax this
  check without such a committed, reviewable mapping.
- **Machine-readable evidence, always.** Every run writes
  `release-verification-evidence.json` (`expected_sha`, per-component `sha`,
  `app_version`, `expected_schema_revision`, `environment`, URLs with
  credentials/query strings/fragments stripped, `timestamp`, and `verdict`)
  regardless of pass/fail — including a bad invocation (missing flags, an
  unparsable `--version-map`), which writes the same evidence shape with an
  `errors` list instead of skipping the file. `release-verification.yml`
  uploads it as a build artifact (`always()`, so a
  failing run's evidence is preserved too) for the release record.

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
| `RELEASE_ALLOWED_HOSTS` repository variable — comma-separated list of the exact approved staging/production Vercel and Railway hostnames (no wildcards) | GitHub repo → Settings → Secrets and variables → Actions → Variables → New repository variable | `EXTERNAL ACCESS REQUIRED` — `release-verification.yml` fails closed until this is set |

Until each row above is confirmed by a human with dashboard access, treat the
corresponding guarantee as **documented but not enforced**, and say so in any
readiness claim.

## 7. Automatic post-deployment verification

`release-verification.yml` also runs automatically on `workflow_run` after
`deploy-staging.yml` ("Deploy Staging") completes successfully on the
`staging` branch (not on PR preview runs, and not on forks — both are
excluded by the job's `if:` condition). This closes the gap where a human
forgets to click "Run workflow" after a staging deploy.

Design constraints this respects, deliberately:

- **No deployment loop.** This workflow only reads deployed state over HTTPS;
  it never deploys anything and cannot re-trigger "Deploy Staging", so there
  is no cycle to runaway.
- **No PR-supplied targets.** The automatic run ignores every field on the
  triggering `workflow_run` event except `head_sha` (used as `expected_sha`)
  and uses only this workflow's own `STAGING_FRONTEND_URL` /
  `STAGING_BACKEND_URL` secrets for the URLs — the same secrets the manual
  default path already uses. A PR cannot smuggle an arbitrary verification
  target or secret through this trigger.
- **Production is not auto-verified.** There is no equivalent `workflow_run`
  hook for production because there is no Actions-based production deploy
  workflow to hook (§1). Production verification stays a required manual
  step in `RELEASE_CHECKLIST.md`: run `release-verification.yml` via
  `workflow_dispatch` with the production URLs supplied explicitly as
  `frontend_url` / `backend_url` inputs (there is no production-URL secret
  today; adding one is an `EXTERNAL ACCESS REQUIRED` step for a future
  change, not assumed here).

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
