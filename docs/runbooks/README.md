# Incident Runbooks — index

**Owner:** TheEyeBeta · **Created:** 2026-07-16 (Phase 9)
Severity/escalation model: [`../readiness/INCIDENT_SEVERITY.md`](../readiness/INCIDENT_SEVERITY.md)
Ownership/contacts: [`../readiness/OWNERSHIP.md`](../readiness/OWNERSHIP.md)
Rollback procedures: [`../readiness/ROLLBACK.md`](../readiness/ROLLBACK.md)

Every runbook has the same eleven sections: Trigger · Severity · User impact ·
Immediate containment · Diagnostics · Dashboards/logs · Recovery · Rollback ·
Validation · Communication · Post-incident.

**Validation honesty:** none of these runbooks has been rehearsed end-to-end.
Each carries `Rehearsed: NO` until a dated drill entry is added — a runbook
without a rehearsal is a hypothesis, not a guarantee.

| Runbook | Typical severity |
| --- | --- |
| [frontend-deploy-failure.md](./frontend-deploy-failure.md) | SEV-2 |
| [backend-deploy-failure.md](./backend-deploy-failure.md) | SEV-2 |
| [readiness-failure.md](./readiness-failure.md) | SEV-2 |
| [database-unavailable.md](./database-unavailable.md) | SEV-1/2 |
| [database-schema-mismatch.md](./database-schema-mismatch.md) | SEV-2 |
| [redis-unavailable.md](./redis-unavailable.md) | SEV-3 |
| [ai-provider-unavailable.md](./ai-provider-unavailable.md) | SEV-2/3 |
| [market-data-unavailable.md](./market-data-unavailable.md) | SEV-3 |
| [auth-oauth-failure.md](./auth-oauth-failure.md) | SEV-2 |
| [elevated-5xx.md](./elevated-5xx.md) | SEV-2/3 |
| [elevated-frontend-errors.md](./elevated-frontend-errors.md) | SEV-2/3 |
| [background-job-backlog.md](./background-job-backlog.md) | SEV-3 |
| [scheduler-failure.md](./scheduler-failure.md) | SEV-3 |
| [account-compromise.md](./account-compromise.md) | SEV-1 |
| [key-leakage.md](./key-leakage.md) | SEV-1 |
| [data-corruption.md](./data-corruption.md) | SEV-1 |
| [backup-restore.md](./backup-restore.md) | SEV-1 context |
| [production-rollback.md](./production-rollback.md) | any |
| [cost-spike.md](./cost-spike.md) | SEV-2/3 |
| [abuse-rate-limit.md](./abuse-rate-limit.md) | SEV-2/3 |

Shared quick diagnostics (first three commands of almost every incident):

```bash
curl -s https://<backend>/health | jq .            # release SHA + supabase/openai status
curl -s https://<backend>/health/ready | jq .      # component-level readiness + degraded flag
curl -s https://<frontend>/ | grep -o '<meta name="release-sha"[^>]*>'
```
