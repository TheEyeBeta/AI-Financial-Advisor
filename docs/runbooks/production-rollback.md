# Runbook: Production rollback

**Rehearsed:** NO (staging rehearsal is a Phase 9 exit requirement — log it here when done)

- **Trigger:** a deployed release is causing an incident and fix-forward is slower or riskier than reverting.
- **Severity:** inherits the driving incident's severity.
- **User impact:** brief switchover; features return to previous behaviour.
- **Authorization:** production rollback requires explicit owner authorization (record who/when in the incident issue).

## Decision rule
Rollback when: broad impact + deploy-correlated + no migration entanglement.
Fix-forward when: the bad release included a schema migration that new data
already depends on (see Migration limitations below), or the defect is narrow.

## Procedure — frontend (minutes)
Vercel → Deployments → last good production deployment → **Promote to Production**.

## Procedure — backend
1. Check migration entanglement FIRST:
```bash
curl -s https://<backend>/health | jq '.release.expected_schema_revision'
git log --oneline <good-sha>..<bad-sha> -- backend/websearch_service/alembic/versions/
```
   Empty log = safe; non-empty = the rollback target expects an older schema → readiness will (correctly) fail the old build against the new schema. Prefer fix-forward, or accept the documented downgrade path below.
2. Railway → service → Deployments → redeploy the previous good deployment.

## Verify the rollback (both components, exact SHA — mandatory)
Once both platforms have redeployed the previous good SHA:
```bash
node scripts/verify-release.mjs \
  --expected-sha <full-good-sha> \
  --frontend <production-frontend-url> \
  --backend <production-backend-url> \
  --allowed-hosts <production-frontend-host>,<production-backend-host>
```
`verify-release.mjs` requires BOTH `--frontend` and `--backend` — a run given
only one is a usage error, not a partial pass. It also requires the full
40-character SHA (there is no short-SHA mode) and rejects any host outside
`--allowed-hosts`. Check `release-verification-evidence.json` for the
per-field detail (`git_sha`, `app_version`, `expected_schema_revision`,
`environment`) if the run fails.

## Migration rollback limitations (read before touching)
- Alembic `downgrade` steps exist but are **not** guaranteed lossless for data-bearing changes; several revisions are effectively forward-only.
- Default posture: **database forward-fix** — write a new revision that reverts the schema effect, promoted through staging like any change.
- Never hand-edit `public.alembic_version` to fool the readiness check.

## Feature/provider disablement (rollback alternatives)
- Provider trouble: fallback is automatic (OpenAI→Perplexity); full AI disablement has no flag — smallest lever is rate-limit config or a targeted deploy.
- Scheduler/worker: unset `SCHEDULER_ENABLED` on the replica to stop scheduled writes without touching web traffic (`scheduler-failure.md`).

## Validation
Both `verify-release` checks pass on the rollback SHA; the driving incident's symptom is gone; error rates baseline for 60 min; journey smoke (sign-in + chat turn + trade read).

## Communication
Note in the incident issue: rolled back from `<bad-sha>` to `<good-sha>`, reason, authorizer.

## Post-incident
The reverted commit must not be re-promoted without the fix + a test that would have caught it; update `../readiness/RELEASE_CHECKLIST.md` rollback-target row (it demanded one — was it correct?).
