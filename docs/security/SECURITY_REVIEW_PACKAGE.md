# Independent Security Review — Handoff Package

**Owner:** TheEyeBeta · **Date:** 2026-07-16 · **Status:** package `IMPLEMENTED`;
the external penetration test itself is **EXTERNAL ACCESS REQUIRED** and has
not been commissioned or performed.

Everything a reviewer needs, in one place. Repo paths are authoritative.

## 1. System overview

- **Architecture + data flow:** `docs/security/THREAT_MODEL.md` §2 (boundary
  diagram), `docs/OPERATIONS.md` (verified architecture), `docs/database-erd.md`
  (schema ERD), ADRs in `docs/adr/`.
- **Frontend:** React/Vite SPA on Vercel (`src/`), CSP + security headers in
  `vercel.json` and `index.html` (regression-tested).
- **Backend:** FastAPI on Railway (`backend/websearch_service/`), OpenAPI
  contract in `docs/openapi.json`.
- **Data/auth:** Supabase Postgres, six schemas, RLS everywhere; Alembic
  migration history in `backend/websearch_service/alembic/`.

## 2. Authentication & authorization

- **Auth flow:** Supabase Auth (email/password + Google OAuth PKCE). Frontend
  session handling: `src/context/AuthContext.tsx`, `src/lib/auth-callback.ts`.
  Backend verification: `app/services/auth.py` (JWT verified per request;
  client-supplied user IDs never trusted on privileged paths).
- **Authorization model:** user vs admin role; admin endpoints under
  `app/routes/admin.py` with role + recent-auth enforcement
  (`test_admin_route_auth.py`, `test_user_account_lifecycle.py`).
- **RLS overview:** all user tables RLS-protected; schema-qualified access
  clients (`src/lib/supabase.ts`); DB-level constraint/RLS tests:
  `tests/test_trading_constraints_db.py` (run against real Postgres in CI).
- **WebSocket security:** single-use hashed tickets, origin validation, no
  tokens in URLs — `app/services/ws_tickets.py`, `tests/test_ws_tickets.py`.

## 3. Sensitive operations

- **Destructive operations:** account suspend/restore/delete
  (`app/services/user_account_lifecycle.py`) — self-delete and final-admin
  guards, typed confirmation, stale-session rejection, audit events.
  Orphan cleanup with dry-run: `app/services/orphan_user_cleanup.py`,
  recovery: `docs/ORPHAN_PURGE_RECOVERY.md`.
- **Audit logging:** `app/services/audit.py`, `tests/test_audit.py`.
- **File/export functionality:** none currently shipped (no user file upload
  or export endpoints) — confirm at review time in `docs/openapi.json`.

## 4. Known limitations (disclose to reviewer)

Ranked residual risks: `THREAT_MODEL.md` §4. Highlights:

1. AI prompt-injection resistance unevaluated (eval suite exists, unexecuted).
2. No global (cross-user) AI request/concurrency/spend ceiling.
3. GitHub branch ruleset documented but unverified.
4. Direct RLS tests uneven across schemas (trading ✔, ai/academy ✖).
5. Duplicate-email OAuth/password linking behaviour depends on Supabase
   project setting (undefined in code).
6. Rate limits fall back to process-local state if Redis/Valkey is absent.

## 5. Rules of engagement (proposed — confirm before testing)

- **Safe target:** the **staging** environment only
  (`STAGING_FRONTEND_URL` / `STAGING_BACKEND_URL`; shared with the reviewer at
  kickoff). Staging uses the test Supabase project — no production user data.
- **Out of scope:** production systems and production data; Supabase, Vercel,
  Railway, OpenAI corporate infrastructure; social engineering; physical;
  DoS beyond agreed rate-limit validation; third-party market-data substrate.
- **Test accounts:** reviewer receives N standard users + 1 admin on staging
  (created for the engagement, deleted after). No production accounts.
- **Data handling:** no exfiltration of other test users' data beyond proof;
  destructive operations only on engagement-owned accounts.
- **Coordination:** notify owner before rate-limit/abuse test bursts; staging
  is shared with CI (deploy-staging E2E runs on pushes to `staging`).

## 6. Reporting format (requested)

Per finding: title; severity (CVSS 3.1 + reviewer judgment); affected
component/endpoint; reproduction steps; evidence; suggested remediation;
retest result. Deliver as a written report plus a walkthrough session.
Findings will be tracked as GitHub issues with the `security` label and
triaged against `docs/readiness/INCIDENT_SEVERITY.md`.

## 7. Evidence the reviewer can rely on

- Control → test map: `SECURITY_TEST_INVENTORY.md`
- CI security gates: `.github/workflows/security.yml` (audits, bandit,
  gitleaks), `dast.yml` (ZAP baseline vs staging)
- Secrets policy: `SECRET_SCANNING.md`, rotation: `KEY_ROTATION.md`
- Telemetry privacy: `TELEMETRY_PRIVACY.md`
- Historical audits (partially remediated; read with their dates):
  `docs/SECURITY_ANALYSIS.md` (2026-03), `SEC-01-remediation.md`,
  `SEC-02-repo-security-audit.md` (2026-02), `BLUE-RED-APPSEC-PLAYBOOK.md`
