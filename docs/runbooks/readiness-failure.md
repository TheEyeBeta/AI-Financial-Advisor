# Runbook: Readiness failure (`/health/ready` not ready)

**Rehearsed:** NO

- **Trigger:** readiness probe returns 503 / `ready: false`; Railway healthcheck failing; deploy stuck not receiving traffic.
- **Severity:** SEV-2 (whole backend held out of service) or SEV-3 (single replica).
- **User impact:** backend features unavailable while not ready.

## Immediate containment
Read the components map — readiness tells you which dependency failed:

```bash
curl -s https://<backend>/health/ready | jq '.components'
```

| Failing component | Go to |
| --- | --- |
| `configuration` | `backend-deploy-failure.md` (env vars; the payload lists `missing`) |
| `database` | `database-unavailable.md` |
| `schema_revision` | `database-schema-mismatch.md` |
| `rate_limit` | `redis-unavailable.md` |
| `startup` | container crash-looped mid-lifespan — Railway logs |
| `search_api` (optional) | informational only — cannot fail readiness, only `degraded` |

## Diagnostics
`release` block in the same payload gives SHA + expected Alembic revision — confirm you're diagnosing the build you think you are.

## Dashboards / logs
Railway logs (startup + healthcheck hits); Supabase status page; Sentry backend.

## Recovery / Rollback / Validation
Per the delegated runbook above. Validation is always: `ready: true`, `degraded` explained or false, one authenticated smoke round-trip.

## Communication
Only if user-visible beyond a deploy window (SEV-2 targets).

## Post-incident
If a component flapped without a real dependency outage, tune `READINESS_TIMEOUT_SECONDS` deliberately (never remove a component check to "fix" readiness).
