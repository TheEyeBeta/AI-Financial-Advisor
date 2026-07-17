# Runbook: Backend deployment failure

**Rehearsed:** NO

- **Trigger:** Railway deploy fails or the new container crash-loops; `verify-release` backend check fails; `/health/live` unreachable post-deploy.
- **Severity:** SEV-2 (SEV-1 if no healthy instance remains).
- **User impact:** IRIS chat, search, trading endpoints, admin — all backend features.

## Immediate containment
1. Railway dashboard → service → Deployments: if the new deploy is unhealthy, **Redeploy the previous successful deployment** (Railway keeps history).
2. Railway's healthcheck gates traffic on the container healthcheck — confirm whether old instance is still serving.

## Diagnostics
```bash
curl -s https://<backend>/health/live
curl -s https://<backend>/health/ready | jq .      # which component failed
```
- Railway deploy + runtime logs. Common causes: missing/placeholder env var (config validation **fails fast at startup by design** — the log names the variable), Alembic revision mismatch (see `database-schema-mismatch.md`), image build failure.
- Check `BOOT:` log line for Python/pid confirmation.

## Dashboards / logs
Railway logs; Sentry (backend project); GitHub Actions `ci.yml#backend` + `docker-build` for the same SHA.

## Recovery
1. If env-var cause: fix the variable in Railway → redeploy same SHA.
2. If code cause: fix on branch → staging → promote. No direct-to-main hotfixes outside the promotion flow unless SEV-1 (then document the exception in the incident issue).

## Rollback
Railway previous-deployment redeploy; DB considerations in `../readiness/ROLLBACK.md` §Backend (check `expected_schema_revision` compatibility before rolling back across a migration boundary).

## Validation
`/health/ready` returns `ready: true`; `verify-release` matches intended SHA; one authenticated chat round-trip on production smoke.

## Communication
Per `INCIDENT_SEVERITY.md` targets; users see explicit failure states in-app meanwhile.

## Post-incident
If startup fail-fast caught a config drift, record the variable in the release checklist environment section; consider adding a config test.
