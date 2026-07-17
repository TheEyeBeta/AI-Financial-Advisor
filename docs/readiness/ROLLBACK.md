# Rollback Procedures — reference

**Owner:** TheEyeBeta · **Created:** 2026-07-16 (Phase 9)
Operational entry point during an incident: [`../runbooks/production-rollback.md`](../runbooks/production-rollback.md).
This document is the fuller reference: mechanisms, limitations, and rehearsal state.

## Rehearsal status (honest)

| Procedure | Rehearsed in non-production? |
| --- | --- |
| Frontend rollback (Vercel promote-previous) | **NO** — mechanism is Vercel-native and low-risk, but log a staging rehearsal before Cohort 1 |
| Backend rollback (Railway redeploy-previous) | **NO** — rehearse on the staging service before Cohort 1 |
| Database forward-fix | **NO** — the *procedure* (new revision through staging) is exercised by every migration PR, but a deliberate revert-revision drill has not been run |
| Migration downgrade | **NOT SUPPORTED as routine** — see limitations |
| Feature-flag disablement | **N/A** — no feature-flag system exists (see below) |
| Provider disablement | Partially inherent (automatic fallback is exercised in tests); manual full-disable drill: NO |
| Worker/scheduler rollback | **NO** — `SCHEDULER_ENABLED` unset drill pending |

## Mechanisms

### Frontend (Vercel)
Instant: promote any previous deployment. State-free (SPA), so the only
coupling is API compatibility — the backend keeps OpenAPI compatibility
within a release window (drift gate in CI), so a one-release frontend
rollback is safe by construction.

### Backend (Railway)
Redeploy a previous deployment/image. Coupling: the schema-revision readiness
gate (#208) — an old build against a newer schema reports not-ready **on
purpose**. Check for migration entanglement before rolling back
(`production-rollback.md` has the exact commands).

### Database
- **Forward-fix is the strategy of record:** write a new Alembic revision
  reverting the schema effect; promote through staging; never bypass.
- **Downgrade limitations:** revisions are not guaranteed lossless downgrades;
  data-bearing changes (backfills, dropped columns) are forward-only in
  practice. Treat `alembic downgrade` against production as an incident-only,
  owner-authorized action with a backup taken first.
- **Restore-based rollback:** `../runbooks/backup-restore.md` — loses the
  RPO window; last resort.

### Feature flags
There is **no runtime feature-flag system** in this codebase today. The
smallest disable levers are: env-var config (where a feature reads one),
scheduler flag (`SCHEDULER_ENABLED`), rate-limit config, or a targeted deploy.
If per-cohort flags become a Phase 10 requirement in practice, that is new
scope — do not pretend a flag exists where one doesn't.

### Providers
AI: OpenAI→Perplexity fallback is automatic per request; there is no "AI off"
switch short of config/deploy. Market data: DataAPI failure degrades to
snapshots automatically (ADR-007).

### Worker / scheduler
Unset `SCHEDULER_ENABLED` (or stop the dedicated scheduler process) to halt
scheduled writes independently of web traffic. Jobs are overwrite-idempotent
on next run.
