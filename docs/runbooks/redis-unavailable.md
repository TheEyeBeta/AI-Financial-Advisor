# Runbook: Redis unavailable

**Rehearsed:** NO

- **Trigger:** `/health/ready` `rate_limit` component degraded/error; Redis connection errors in Railway logs; WS ticket issuance failing.
- **Severity:** SEV-3 (designed fallback exists) — SEV-2 if running multiple web replicas (limits/tickets become per-process and materially weaker).
- **User impact:** none directly; protection quality degrades (rate limits reset on restart, WS tickets process-local).

## Immediate containment
1. Confirm the fallback engaged: backend logs show memory-store fallback (`test_get_store_falls_back_to_memory_without_redis` behaviour).
2. If running >1 web replica, scale to 1 replica until Redis returns (restores correctness of limits/tickets at the cost of capacity).

## Diagnostics
```bash
curl -s https://<backend>/health/ready | jq '.components.rate_limit'
redis-cli -u "$REDIS_URL" ping        # from a trusted shell, never paste the URL into logs
```
Provider dashboard (Railway plugin / Upstash): memory ceiling, connection cap, eviction events.

## Dashboards / logs
Redis provider dashboard; Railway backend logs.

## Recovery
- Provider incident: wait/restore; backend reconnects without redeploy.
- Credential rotation needed: `docs/security/KEY_ROTATION.md` §5.
- Memory ceiling: raise plan or clear non-critical keys (rate-limit keys are TTL'd; never flush WS ticket keys while sessions are active unless forcing re-auth is acceptable).

## Rollback
Not applicable.

## Validation
`rate_limit` component `ok`; a WS ticket round-trip succeeds; limits survive a backend restart (issue a few requests, restart, confirm counters persisted).

## Communication
None user-facing unless combined with another incident.

## Post-incident
If the outage exceeded an hour with >1 replica, note in the incident issue that abuse exposure was elevated; check audit logs for anomalous request bursts during the window (`abuse-rate-limit.md` diagnostics).
