# Staged Launch — controlled 150-user beta admission

**Owner:** TheEyeBeta · **Created:** 2026-07-16 (Phase 10)
Companions: [`BETA_TELEMETRY_TEMPLATE.md`](./BETA_TELEMETRY_TEMPLATE.md),
[`BETA_FEEDBACK.md`](./BETA_FEEDBACK.md),
[`LAUNCH_DECISION_TEMPLATE.md`](./LAUNCH_DECISION_TEMPLATE.md).

**Prime directive:** expansion is a *decision with evidence*, never a
default. "Seems fine" admits nobody.

## 1. Admission control — current mechanism status (honest)

| Control | Mechanism | Status |
| --- | --- | --- |
| Invite-only registration | **No in-app invite system exists.** Control is operational: Supabase Auth → Providers → Email → "Allow new users to sign up" toggled OFF except during invitation windows; invitees are created via Supabase Auth admin invite (emails an invite link) or admitted during a scheduled open window communicated only to the cohort | `EXTERNAL ACCESS REQUIRED` (dashboard-operated; verify the toggle exists on the project's current plan and rehearse once before Cohort 0) |
| Hard account cap | No code-level cap. Enforced operationally: cohort sizes + signup toggle + weekly count check (`SELECT count(*) FROM core.users`) | `MANUAL VERIFICATION REQUIRED` per cohort report |
| Pause new signups | Same Supabase toggle — takes effect immediately | `EXTERNAL ACCESS REQUIRED` |
| Suspend invitations | Stop sending invites (operational); revoke unaccepted invites in Supabase Auth users list | `EXTERNAL ACCESS REQUIRED` |
| Cohort assignment | Tracked in the cohort register (a private spreadsheet/table listing email → cohort → invited/activated dates). No schema column; add `core.users.cohort` only if reporting pain justifies a migration | `IMPLEMENTED` (process) |
| Per-cohort feature flags | **No feature-flag system exists** (`ROLLBACK.md` §Feature flags) — declared out of scope for the beta rather than pretended | N/A — documented limitation |
| Admin view of active users | Admin endpoints exist (`app/routes/admin.py`); active-user counts also via Supabase dashboard/SQL | `IMPLEMENTED` |
| AI quota visibility | Per-user token/request counters live in the rate limiter; surfacing: rate-limit headers per request + operator inspection; no admin dashboard panel | Partial — dashboard panel is a `docs/MONITORING_IMPLEMENTATION_PLAN.md` item |
| Abuse controls | Rate limits + auto-block + account suspension (tested) | `AUTOMATED TEST PASSED` (see `docs/runbooks/abuse-rate-limit.md`) |

## 2. Cohorts

| Cohort | Size (cumulative) | Population | Duration before gate |
| --- | --- | --- | --- |
| 0 | 5–10 | internal/friendly users | 48–72 h |
| 1 | 25 | external invitees | 5–7 days |
| 2 | 75 | external | 5–7 days |
| 3 | 150 | external | steady state |

## 3. Entry criteria (every cohort)

- Required green release SHA: the exact SHA passed the full
  `RELEASE_CHECKLIST.md` including `release-verification.yml` against
  production; no mandatory CI failure on it.
- No unresolved SEV-1 or SEV-2 incident (open `incident` issues checked).
- No known data-integrity defect (integrity queries clean within 7 days).
- No unresolved critical/serious accessibility defect on critical pages
  (axe CI green + no open `a11y` blocking issue).
- AI cost behaviour controlled: provider budget alert configured
  (**verify before Cohort 1 — EXTERNAL**), previous window's cost per active
  user within 2× projection.
- Cohort-specific:
  - **Cohort 0:** all of the above; screen-reader scripts SR-1/SR-2 executed
    at least once (`SCREEN_READER_SCRIPTS.md` log has entries).
  - **Cohort 1:** backup owner named in `OWNERSHIP.md`; Supabase signup
    toggle rehearsed; restore procedure rehearsed once
    (`docs/recovery/BACKUP_VERIFICATION_CHECKLIST.md` evidence).
  - **Cohort 2:** AI eval suite executed with committed report, zero hard
    safety failures (`evals/README.md`); SR-3 (TalkBack) executed.
  - **Cohort 3:** independent security review at least scheduled with the
    package delivered (`docs/security/SECURITY_REVIEW_PACKAGE.md`).

## 4. Exit / promotion criteria (measured over the cohort window)

| Metric | Threshold | Source |
| --- | --- | --- |
| Availability (outside-in, `/health/ready`) | ≥ 99.5% beta floor (SLO target 99.9%) | `docs/SLO.md` §1 |
| Backend 5xx rate | < 1% of requests | Sentry/logs |
| Frontend error-affected sessions | < 3% | Sentry |
| Onboarding completion (started → completed) | ≥ 70% | telemetry report |
| AI turn failure rate (after fallback) | < 3% | audit events / Sentry |
| Support volume | < 1 request per 3 active users per week | inbox count |
| Data integrity | zero defects found | integrity queries |
| Incidents | zero unresolved SEV-1/2; SEV-3s triaged | issue tracker |

**Rollback trigger (shrink/pause the beta):** any SEV-1; two SEV-2s in a
window; availability < 99%; data-integrity defect; uncontrolled cost
(> 3× projection with no explanation). Action: pause signups (toggle),
suspend invitations, and if needed suspend the newest cohort's accounts —
each step reversible via the restore endpoint.

**Promotion decision owner:** TheEyeBeta (backup owner may veto, not
approve alone). Every gate produces a `LAUNCH_DECISION_TEMPLATE.md` record
committed under `docs/readiness/decisions/`.

## 5. Hard rules (non-negotiable)

- No unresolved SEV-1 or SEV-2 issue at expansion time.
- No known data-integrity defect.
- No mandatory CI failure on the running SHA.
- No unresolved critical accessibility defect.
- No uncontrolled AI-cost behaviour.
- **No admission expansion during an active incident** — of any severity.

## 6. External/manual boundaries

Without explicit owner authorization, do not: invite real users; send
communications; increase production account limits; enable paid AI load;
promote cohorts; modify production feature toggles. Each of these is
`MANUAL VERIFICATION REQUIRED` / `EXTERNAL ACCESS REQUIRED` and outside what
any automation or agent may perform.
