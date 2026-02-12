# Blue Team / Red Team / AppSec Playbook

This playbook translates security ownership into concrete, repeatable tasks for this repository.

## 1) Scope & Assets

### Critical assets
- User authentication/session state via Supabase (`src/context/AuthContext.tsx`, `src/lib/supabase.ts`).
- Financial/user profile data in Supabase tables (`sql/schema.sql`).
- AI backend proxy and audit stream (`backend/websearch_service/app/routes/ai_proxy.py`, `backend/websearch_service/app/services/audit.py`).
- Trade-engine/websocket data paths (`src/services/tradeEngineWebSocket.ts`, `src/hooks/use-trade-engine.ts`).

### Primary trust boundaries
- Browser client ↔ Supabase APIs.
- Browser client ↔ backend websearch/AI proxy.
- Backend service ↔ LLM provider API.

---

## 2) Red Team Plan (Offensive Validation)

Run quarterly and before major releases.

### RT-1: Auth/session abuse
- Try bypassing protected pages by forcing client-side state transitions.
- Replay or tamper with cached auth state and refresh flows.
- Validate unauthorized users cannot access protected API data even if UI route is forced.

### RT-2: RLS bypass and data overexposure
- Probe for cross-user data reads/writes by varying `user_id` references in API calls.
- Validate all table RLS policies map to intended role access (including `anon` vs `authenticated` semantics).
- Confirm "public-read" tables are only the intended ones and cannot be chained to sensitive joins.

### RT-3: AI prompt injection & abuse
- Attempt prompt injection through user messages and external/news content.
- Attempt data exfiltration patterns (system prompt leak, key disclosure prompts, role confusion).
- Stress test rate limits and malformed payloads on AI proxy endpoints.

### RT-4: Supply-chain abuse
- Introduce known vulnerable transitive dependencies in a branch and ensure CI security gates fail.
- Validate lockfile integrity and dependency review before merge.

---

## 3) Blue Team Plan (Detection & Response)

### BT-1: Logging and telemetry
- Ensure security-relevant events are captured as structured logs (auth failures, rate-limit events, elevated errors).
- Preserve and rotate `logs/audit.jsonl` with retention policy.
- Add dashboards/alerts for:
  - auth failures spike,
  - sudden `429` spikes,
  - repeated backend 5xx responses on AI endpoints.

### BT-2: Detection engineering
- Define triage rules:
  - Multiple failed sign-ins from same IP/user within window.
  - Abnormal prompt volumes per user/IP.
  - Unexpected access from `anon` to non-public data paths.

### BT-3: Incident response runbook
- Severity matrix:
  - **SEV-1:** confirmed data exfiltration or auth bypass.
  - **SEV-2:** active abuse affecting availability (DoS/rate-limit evasion).
- Immediate actions:
  - rotate impacted credentials,
  - block abusive IP/user token patterns,
  - enforce maintenance mode or endpoint throttling.

---

## 4) AppSec Plan (Preventive Controls)

### AS-1: CI security gates (automated)
- Run dependency vulnerability scans for Node and Python.
- Run static analysis for Python backend security smells.
- Run secret scanning on every push/PR.

### AS-2: Secure coding standards for this repo
- Keep provider/API keys server-side only.
- Maintain explicit role grants in RLS policies; avoid implied defaults.
- Validate all external input at backend boundaries.
- Enforce least privilege on service keys and CI secrets.

### AS-3: Release security checklist
Before release:
1. Lint + type-check pass.
2. Unit/integration tests pass.
3. Security workflow passes.
4. Manual red-team smoke scenarios executed for auth and data-access paths.
5. RLS diff reviewed by AppSec.

---

## 5) Prioritized Backlog

### P0 (this sprint)
- [ ] Add JWT/session auth middleware to backend AI routes.
- [ ] Add explicit schema migration tests for RLS policy intent.
- [ ] Add request-size limits and stricter payload validation for AI routes.

### P1
- [ ] Add WAF/API-gateway rate limits in deployment.
- [ ] Add anomaly alerting pipeline for audit logs.
- [ ] Add adversarial prompt regression test suite.

### P2
- [ ] Table-level data classification matrix.
- [ ] Signed SBOM generation and attestation in CI.

---

## 6) Ownership Model

- **Red Team owner:** Security engineering (offensive testing cadence, findings).
- **Blue Team owner:** Platform/SRE (telemetry, alerting, incident response).
- **AppSec owner:** Product security (threat modeling, secure SDLC controls, release gate signoff).

Each finding should include: severity, exploitability, affected assets, fix owner, SLA, and verification evidence.
