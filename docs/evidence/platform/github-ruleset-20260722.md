# Evidence — GitHub branch ruleset update: readiness-controls required (M1 follow-up)

**Date / time:** 2026-07-22 03:41 +01:00
**Configured by:** agent session (GitHub API, `gh` CLI, token scope `repo`)
**Repository:** https://github.com/TheEyeBeta/AI-Financial-Advisor
**Ruleset:** `Production branch protection` (ID `19108544`) — same ruleset verified in `github-ruleset-20260717.md`

## What changed

Added the three `readiness-controls.yml` job checks to the ruleset's
required-status-checks list. These jobs already ran on every `pull_request`
(no path filter, no branch restriction on the `pull_request` trigger — see
`.github/workflows/readiness-controls.yml`), so requiring them cannot strand
a PR by silently skipping.

Read the ruleset (`GET /repos/TheEyeBeta/AI-Financial-Advisor/rulesets/19108544`),
added three entries to `rules[].parameters.required_status_checks` leaving
every other field (conditions, pull_request rule, deletion/non_fast_forward,
bypass_actors, enforcement) byte-for-byte unchanged, then wrote it back
(`PUT /repos/TheEyeBeta/AI-Financial-Advisor/rulesets/19108544`).

## Required checks (before → after)

Before (9, per `github-ruleset-20260717.md`):
`Frontend Quality & Build`, `Backend Tests`, `Docker Build Test`, `quality`,
`test`, `Node dependency audit`, `Python dependency audit`,
`Python static security scan`, `Secret scanning (gitleaks)`.

Added (3):
1. `Environment-schema validation (synthetic vars)` — `readiness-controls.yml` job `env-schema`
2. `Evidence-schema validation (tamper-evident digests)` — `readiness-controls.yml` job `evidence-schema`
3. `AI-provider test-network guard active` — `readiness-controls.yml` job `network-guard`

After: 12 required checks total.

## Also folded into this same change: Docker-build consolidation

`.github/workflows/docker-build.yml` (`Test Docker Builds`, path-filtered on
`backend/**`/`deployment/Dockerfile*`, PR-only) was never in the required
list — the 2026-07-17 evidence file notes it was deliberately excluded
because a path-filtered check could strand PRs that don't touch those paths.
Its unique steps (frontend image build, `docker compose config` validation)
were folded into `ci.yml`'s unconditional `docker-build` job (already
required as `Docker Build Test`), and the now-fully-redundant
`docker-build.yml` file was deleted. No required-check name changed as a
result — `Docker Build Test` already covered the backend build + smoke
tests; it now also covers the frontend build + compose validation.

## Verification

API read confirmed `enforcement: active`, `updated_at: 2026-07-22T03:41:45.078+01:00`,
and all 12 contexts listed under `required_status_checks` (see above) via:

```bash
gh api repos/TheEyeBeta/AI-Financial-Advisor/rulesets/19108544
```

**Live PR probe (2026-07-22, later same day):** opened PR #262 (commit
`a449435645aa3d0ea5c19bf2afc64c6ab5fd5bbf`) and watched all 12 required
checks actually report:

```text
pass  AI-provider test-network guard active
pass  Backend Tests
pass  Docker Build Test
pass  Environment-schema validation (synthetic vars)
pass  Evidence-schema validation (tamper-evident digests)
pass  Frontend Quality & Build
pass  Node dependency audit
pass  Python dependency audit
pass  Python static security scan
pass  Secret scanning (gitleaks)
pass  quality
pass  test
```

`gh pr view 262 --json mergeable,mergeStateStatus` reported
`{"mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED"}` — blocked solely on
the required 1 approving review (`reviewDecision: REVIEW_REQUIRED`, zero
reviews), not on any status check. This confirms the 12-check requirement
is enforced, not just configured.

Note: PR #262 was initially opened against `staging`, which is 27 commits
behind `main` in this repo — that produced a misleading diff and caused
`e2e.yml`'s `test` job to never trigger (its trigger is
`branches: [main, develop]`, excluding `staging`). Retargeting the PR to
`main` and reopening it (to fire a fresh `pull_request` event) resolved
both; see the PR discussion for detail. This is an unrelated, pre-existing
repo-wiring gap (not something this ruleset change caused) worth fixing
before relying on `staging`-targeted PRs to gate merges going forward.
