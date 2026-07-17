# Operational Ownership Matrix

**Owner:** TheEyeBeta · **Created:** 2026-07-16 (Phase 9)
Placeholders (`[UNASSIGNED]`) are deliberate: the beta currently has a single
named operator. **Filling the backup column is a Cohort 1 entry condition**
(`STAGED_LAUNCH.md`) — a solo on-call cannot honestly meet SEV-1 targets
year-round.

| System | Primary owner | Backup owner | Credentials owner | Alert recipient | Escalation path |
| --- | --- | --- | --- | --- | --- |
| Frontend (Vercel project) | TheEyeBeta | `[UNASSIGNED]` | TheEyeBeta | TheEyeBeta (Sentry frontend) | owner → backup → Vercel support |
| Backend (Railway services: prod, staging, scheduler) | TheEyeBeta | `[UNASSIGNED]` | TheEyeBeta | TheEyeBeta (Sentry backend) | owner → backup → Railway support |
| Database/Auth (Supabase project) | TheEyeBeta | `[UNASSIGNED]` | TheEyeBeta | TheEyeBeta | owner → backup → Supabase support |
| Redis | TheEyeBeta | `[UNASSIGNED]` | TheEyeBeta | TheEyeBeta | owner → provider support |
| AI providers (OpenAI, Perplexity, Tavily) | TheEyeBeta | `[UNASSIGNED]` | TheEyeBeta | TheEyeBeta (billing alerts — verify configured, EXTERNAL) | owner → provider support |
| Market data (TheEyeBetaDataAPI) | TheEyeBeta | `[UNASSIGNED]` | TheEyeBeta | TheEyeBeta | owner → substrate operator |
| GitHub repo + Actions + rulesets | TheEyeBeta | `[UNASSIGNED]` | TheEyeBeta | TheEyeBeta | owner → GitHub support |
| Sentry (both projects) | TheEyeBeta | `[UNASSIGNED]` | TheEyeBeta | TheEyeBeta | owner |
| Google OAuth (Cloud Console) | TheEyeBeta | `[UNASSIGNED]` | TheEyeBeta | TheEyeBeta | owner → Google support |
| Incident command (SEV-1/2) | TheEyeBeta | `[UNASSIGNED]` | — | — | `INCIDENT_SEVERITY.md` |
| User communications / disclosure | TheEyeBeta | `[UNASSIGNED]` | — | — | owner (+ legal `[UNASSIGNED]` for disclosure questions) |
| Key rotation authority | TheEyeBeta | `[UNASSIGNED]` | per `docs/security/KEY_ROTATION.md` table | — | — |

Review cadence: at every cohort gate, and whenever a credential or platform
changes hands. This table is the answer to "who do I wake up" — keep it
truthful over aspirational.
