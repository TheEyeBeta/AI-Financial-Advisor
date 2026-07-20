# Incident Severity, Escalation and Response Targets

**Owner:** TheEyeBeta · **Created:** 2026-07-16 (Phase 9) · Applies to the 150-user beta.

## Severity levels

```text
SEV-1 — Data loss, account compromise, broad outage
SEV-2 — Core feature unavailable or major degradation
SEV-3 — Limited degradation with workaround
SEV-4 — Minor or cosmetic defect
```

| Level | Definition (this product) | Examples |
| --- | --- | --- |
| SEV-1 | Confirmed data loss/corruption, account or key compromise, or `/health/ready` down across all backend replicas with the frontend unusable | service-role key leaked; trading tables corrupted; auth fully broken |
| SEV-2 | A core journey (sign-in, onboarding, IRIS chat, paper trading) unavailable or majorly degraded for many users | OpenAI + fallback both failing; DB schema mismatch blocking readiness; Google OAuth broken |
| SEV-3 | Degraded with a workaround; single feature or subset of users | market data on snapshot fallback; Redis/Valkey down (rate limits process-local); academy quiz save flaky |
| SEV-4 | Cosmetic/minor, no journey blocked | styling glitch, copy error, non-blocking console noise |

## Response targets (beta, single-operator reality)

| Level | Acknowledge | Mitigate/contain | Resolve or downgrade | Status updates |
| --- | --- | --- | --- | --- |
| SEV-1 | 30 min (waking hours), 4 h worst-case | 2 h | 24 h | every 2 h to affected users if user-visible |
| SEV-2 | 2 h | 8 h | 3 days | daily |
| SEV-3 | 1 business day | 3 days | next release | in release notes |
| SEV-4 | triage weekly | — | backlog | — |

These are honest targets for a solo operator with placeholders for backup
contacts — revise when `OWNERSHIP.md` names a second responder.

## Escalation path

1. **Detect** — Sentry alert, `/health/ready` probe, user report, cost alert.
2. **Declare** — open a GitHub issue titled `[SEV-n] <summary>` with the
   `incident` label; record start time and current release SHA (from
   `/health` and the frontend `release-sha` meta tag).
3. **Contain** — follow the matching runbook in `docs/runbooks/`.
4. **Escalate** — SEV-1/SEV-2: notify the backup owner (`OWNERSHIP.md`); for
   suspected compromise also start `docs/runbooks/key-leakage.md` immediately.
5. **Close** — post-incident notes on the issue within 5 days for SEV-1/2:
   timeline, root cause, user impact, actions (with owners + dates).

## Hard rules during any active incident

- No cohort expansion (`STAGED_LAUNCH.md` hard rule).
- No production deploys except the fix/rollback for the incident itself.
- Never disable auth, RLS, or rate limiting to "restore service".
