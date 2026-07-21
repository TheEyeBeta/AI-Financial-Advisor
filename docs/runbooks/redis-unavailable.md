# Runbook: Redis (Valkey) unavailable

**Rehearsed:** NO

**Backing store:** production runs [Valkey](https://valkey.io) (BSD-3-Clause,
Linux Foundation fork of Redis 7.2.4), not Redis Ltd.'s Redis — see
`docs/security/KEY_ROTATION.md` §5 and `deployment/DEPLOYMENT.md` for why.
It is wire-compatible with Redis (RESP protocol, same Lua `EVAL` support),
so the app still connects via `redis-py` and the `REDIS_URL` /
`RATE_LIMIT_REDIS_URL` env vars are unchanged — every command below
(`redis-cli`, log strings, code paths) applies identically.

- **Trigger:** `/health/ready` `rate_limit` or `ai_budget_guard` component degraded/error; Valkey connection errors in Railway logs; WS ticket issuance failing.
- **Severity:** SEV-3 only in the single-worker, `ALLOW_IN_MEMORY_RATE_LIMIT=true` beta case (designed fallback exists) — **SEV-2 by default with >1 web replicas** (the backend fails to start, a full outage, not a degradation), and SEV-2 regardless of worker count if `AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE=true` is set (spend becomes uncapped for the outage duration).
- **User impact:** direct and significant, not just quality-of-protection
  degradation. The global AI budget guard fails **closed** by default —
  every AI-proxy call (IRIS chat, analysis) returns 503
  `reason_code: redis_unavailable` until Valkey recovers. `/health/ready`
  reports `ai_budget_guard` degraded/error. With >1 web worker/replica the
  backend **fails to start entirely** (`FATAL`, see diagnostics below) —
  a full outage, not a soft degradation. Only in the single-worker,
  `ALLOW_IN_MEMORY_RATE_LIMIT=true` case do things merely degrade (rate
  limits reset on restart, WS tickets process-local).

## Immediate containment
1. Check worker/replica count first — it determines what "engaged" looks
   like. **Single worker + `ALLOW_IN_MEMORY_RATE_LIMIT=true`:** confirm the
   fallback engaged via backend logs showing memory-store fallback
   (`test_get_store_falls_back_to_memory_without_redis` behaviour) for the
   per-user rate limiter. **>1 web worker/replica:** there is no fallback —
   confirm instead that the backend is crash-looping with `FATAL:
   Production is configured with multiple workers but REDIS_URL is
   missing` (or the AI-budget equivalent) in the logs; this is expected,
   by-design behavior, not a separate bug to fix mid-incident. In both
   cases: `AI budget guard: Redis outage during reserve()` for the global
   AI budget guard.
2. Understand degraded-mode semantics while Redis is down: in the
   single-worker fallback case, limits and WS tickets are **process-local
   and reset on every backend restart** — that is inherent to the memory
   fallback, not something to "fix" mid-incident. With >1 replica there is
   no degraded mode to understand — the service is down until Valkey
   returns (scaling to 1 replica alone does **not** restart it — see step 3).
   The **global AI budget guard fails closed by default** (`AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE=false`,
   the default) — every AI-proxy call returns 503 `reason_code: redis_unavailable`
   until Redis recovers. This is deliberate: it protects the spend budget
   over availability. If the outage is prolonged and availability is judged
   more important, that is an explicit, logged operator decision (set
   `AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE=true` and redeploy) — never a silent one.
3. If running >1 web replica, scaling to 1 replica alone does **not**
   restart the service — `validate_rate_limit_configuration()` still
   raises `FATAL` at 1 worker if Valkey is unreachable and
   `ALLOW_IN_MEMORY_RATE_LIMIT` isn't set. To deliberately run degraded
   while Valkey is down: scale to exactly 1 replica **and** set
   `ALLOW_IN_MEMORY_RATE_LIMIT=true`, then redeploy — this is an explicit
   availability-over-correctness decision (cross-replica inconsistency is
   moot at 1 replica, but state still doesn't persist across restarts, and
   the AI budget guard still fails closed unless
   `AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE=true` is also set). Otherwise,
   the correct action is simply to wait for Valkey to recover.

## Diagnostics
```bash
curl -sS https://<backend>/health/ready | jq '(.detail // .) | .components | {rate_limit, ai_budget_guard}'
redis-cli -u "$REDIS_URL" ping        # from a trusted shell, never paste the URL into logs
```
Provider dashboard (Railway Valkey service): memory ceiling, `maxclients`
connection cap, eviction events. A crash-loop where every worker dies with
`FATAL: Production is configured with multiple workers but REDIS_URL is
missing` while `REDIS_URL` *is* set is usually **not** a missing-config
issue — check `CLIENT LIST` / connection count against `maxclients` first;
`ping()` failing due to connection exhaustion is indistinguishable from
"no Redis configured" to `validate_rate_limit_configuration()`.

## Dashboards / logs
Valkey provider dashboard; Railway backend logs.

## Recovery
- Provider incident: wait/restore; backend reconnects without redeploy.
- Credential rotation needed: `docs/security/KEY_ROTATION.md` §5.
- Memory ceiling: raise plan or clear non-critical keys (rate-limit keys are TTL'd; never flush WS ticket keys while sessions are active unless forcing re-auth is acceptable).

## Rollback
Not applicable.

## Validation
**After Redis has recovered** (these checks are meaningless in fallback mode):
`rate_limit` component `ok`; a WS ticket round-trip succeeds; limits survive a
backend restart (issue a few requests, restart, confirm counters persisted);
with >1 replica, counters are consistent across replicas.

## Communication
None user-facing unless combined with another incident.

## Post-incident
If the outage exceeded an hour with >1 replica, note in the incident issue that abuse exposure was elevated; check audit logs for anomalous request bursts during the window (`abuse-rate-limit.md` diagnostics).
