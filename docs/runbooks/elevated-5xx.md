# Runbook: Elevated backend 5xx rate

**Rehearsed:** NO

- **Trigger:** Sentry backend error spike; SLO burn (`docs/SLO.md` §2 error-rate objective); users reporting failures across features.
- **Severity:** SEV-2 (>5% of requests) / SEV-3 (elevated but bounded).
- **User impact:** proportional to the failing route class.

## Immediate containment
1. Identify the top failing route + error class in Sentry (group by transaction). One route = feature incident (delegate to that runbook); all routes = platform/dependency incident.
2. Check whether it started at a deploy boundary:
```bash
curl -s https://<backend>/health | jq '.release'   # what SHA is serving?
```
   If yes and impact is broad → roll back first, diagnose after (`production-rollback.md`).

## Diagnostics
- Correlation IDs: pick a failing request ID from Sentry, trace it through Railway logs (`middleware/correlation.py`).
- `/health/ready` components — dependency degradation shows here first.
- Memory/CPU on Railway metrics (OOM kills look like random 5xx bursts + restarts).

## Dashboards / logs
Sentry backend (release-tagged — compare error rate by release SHA), Railway metrics + logs.

## Recovery
Deploy-correlated → rollback. Dependency-correlated → that dependency's runbook. Load-correlated → verify rate limiting is engaged (`abuse-rate-limit.md`) before scaling replicas (remember: >1 replica requires Redis/Valkey for correct limits).

## Rollback
`production-rollback.md`.

## Validation
5xx rate back under SLO threshold for 60 min; no stuck chat turns (reconciliation clears).

## Communication
Per severity targets; be specific about which features were affected.

## Post-incident
Record against error-budget; if the failing class had no test, add the regression test with the fix (journey matrix update).
