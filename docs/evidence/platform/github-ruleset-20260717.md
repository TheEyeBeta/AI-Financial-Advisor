# Evidence — GitHub branch ruleset (M1)

**Date / time (final verify):** 2026-07-17 17:03 +01:00  
**Configured by:** TheEyeBeta  
**Verified by:** agent session (GitHub API + live push probes)  
**Repository:** https://github.com/TheEyeBeta/AI-Financial-Advisor  
**Rules page:** https://github.com/TheEyeBeta/AI-Financial-Advisor/rules  
**Ruleset HTML:** https://github.com/TheEyeBeta/AI-Financial-Advisor/rules/19108544  

## Verdict

**COMPLETE.** Ruleset `Production branch protection` is **Active**, targets `main` (default) and `staging`, enforces PR/review/status gates, and blocks force-push/deletion with an empty bypass list.

## Ruleset snapshot (API)

| Field | Value |
| --- | --- |
| Ruleset name | `Production branch protection` |
| Ruleset ID | `19108544` |
| Enforcement | `active` |
| Target branches | `~DEFAULT_BRANCH`, `refs/heads/staging` |
| Bypass actors | empty (`current_user_can_bypass: never`) |
| Restrict deletions | yes |
| Block force pushes | yes |
| Require PR before merging | yes |
| Required approvals | 1 |
| Dismiss stale approvals on push | yes |
| Require approval of most recent reviewable push | yes |
| Require conversation resolution | yes |
| Require status checks + up to date | yes |

### Required checks (final)

1. `Frontend Quality & Build`
2. `Backend Tests`
3. `Docker Build Test`
4. `quality`
5. `test`
6. `Node dependency audit`
7. `Python dependency audit`
8. `Python static security scan`
9. `Secret scanning (gitleaks)`

Release-verification check: add later when that job exists and runs on PRs.

## Applied rules

- `main`: 4 rule types applied  
- `staging`: 4 rule types applied  

## Live probes

| Test | Result |
| --- | --- |
| Direct push to `main` | Rejected (`GH013`) |
| Direct push to `staging` | Rejected (`GH013`; “11 of 11 required status checks” at prior probe; check count now 9 after cleanup) |
| Force push to `main` | Rejected (earlier session) |
| Delete `main` | Rejected (earlier session) |
| Merge without approval / unresolved thread | Blocked on PR #249 (earlier session) |
| Stale approval dismiss (live) | Config verified; live approve→push needs a second GitHub user |

## Screenshot references

1. https://github.com/TheEyeBeta/AI-Financial-Advisor/rules  
2. https://github.com/TheEyeBeta/AI-Financial-Advisor/rules/19108544  
3. Closed test PR: https://github.com/TheEyeBeta/AI-Financial-Advisor/pull/249  

## Notes

Earlier misconfiguration (`refs/heads/refs\heads\staging`, and requiring `Backend Integration Tests (Supabase)` / `Test Docker Builds`) was corrected. Integration tests do not run on PRs; path-filtered docker workflow can skip — both would strand merges if required.
