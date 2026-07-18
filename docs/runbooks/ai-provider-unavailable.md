# Runbook: AI provider unavailable

**Rehearsed:** NO

- **Trigger:** spike of `openai_fallback_perplexity` audit events; chat turns failing; `/health` reports `openai: error`; Sentry provider-error class rising.
- **Severity:** SEV-3 while the Perplexity fallback carries traffic; SEV-2 when both providers fail (IRIS effectively down).
- **User impact:** slower/degraded answers on fallback; explicit failure states when both down. Paper trading, academy, auth unaffected.

## Immediate containment
1. Classify from audit events (`core.audit_events` in production — see `docs/security/AUDIT_TRAIL.md`; `logs/audit.jsonl` only in local dev): `rate_limit_429` vs `service_unavailable_503` vs `network_error` vs `quota_exceeded_402`.
2. `quota_exceeded_402` = **billing/budget**, not an outage → jump to `cost-spike.md` (raising the budget is a deliberate owner decision, not a reflex).
3. Both providers down: nothing to fix locally — users already see explicit failure states; monitor and communicate.

## Diagnostics
```bash
curl -s https://<backend>/health | jq '.services.openai'
# Production: query the durable audit trail (service role required).
# SELECT action, reason_code, created_at FROM core.audit_events
#   WHERE action = 'openai_fallback_perplexity' ORDER BY created_at DESC LIMIT 20;
grep openai_fallback logs/audit.jsonl | tail -20     # local dev only — not populated in production
```
Provider status pages: status.openai.com, status.perplexity.ai.

## Dashboards / logs
Sentry backend (failure class + correlation IDs); audit log; OpenAI usage dashboard.

## Recovery
- Provider recovers → traffic shifts back automatically (fallback is per-request).
- Key invalid (401 pattern) → rotate per `docs/security/KEY_ROTATION.md` §3.
- Sustained 429 with normal user load → check for abuse (`abuse-rate-limit.md`) before raising provider tier.

## Rollback
Not applicable unless triggered by a model/prompt change deploy — then roll back the deploy (`production-rollback.md`) and note that model changes require eval evidence (`docs/ai/AI_CONTROLS.md` §4).

## Validation
Live chat turn succeeds on primary provider; fallback audit-event rate back to baseline; turn reconciliation shows no stuck turns.

## Communication
SEV-2 (both down): in-app state already explicit; post a status note if >1 h.

## Post-incident
Record failure class distribution; if `quota_exceeded`, feed into the Phase 7 G-1 global-budget gap justification in `docs/ai/AI_CONTROLS.md`.
