# Runbook: Database unavailable

**Rehearsed:** NO

- **Trigger:** `/health/ready` `database` component erroring; Supabase queries timing out; frontend data panels failing across the board.
- **Severity:** SEV-1 (all persistence down) / SEV-2 (intermittent).
- **User impact:** sign-in, chat history, trading, onboarding — effectively full outage.

## Immediate containment
1. Check https://status.supabase.com and the Supabase project dashboard (paused project? compute limits? incident?).
2. **Do not restart-loop the backend** — it fails readiness by design and recovers automatically when the DB returns.
3. If this is a Supabase-side incident: wait it out; post user comms per targets. There is no self-hosted failover in the beta architecture (accepted risk).

## Diagnostics
```bash
curl -s https://<backend>/health/ready | jq '.components.database'
```
Supabase dashboard → Database → health/connections (pool exhaustion vs hard outage); Logs → Postgres logs.

## Dashboards / logs
Supabase dashboard, Supabase status page, Sentry backend (timeout error class), Railway logs.

## Recovery
- Supabase incident: automatic on their recovery; verify readiness flips to ready.
- Pool exhaustion: identify the offending query pattern in Postgres logs; scale compute tier as stopgap; fix the pattern properly via PR.
- Paused/billing issue: restore project state in dashboard (owner action).

## Rollback
Not applicable (no schema change involved). If triggered by a migration, switch to `database-schema-mismatch.md` / `../readiness/ROLLBACK.md` §Database.

## Validation
Readiness green; sign-in + one chat turn + one paper-trade read succeed; error rate at baseline for 30 min.

## Communication
SEV-1 cadence (every 2 h). Be explicit that no data was lost unless proven otherwise — and if writes failed mid-flight, direct users to re-check their last action rather than promising integrity you haven't verified.

## Post-incident
Record duration against the 99.9% SLO error budget (`docs/SLO.md`); if pool-related, add the query fix and consider connection-limit alerting in the monitoring plan.
