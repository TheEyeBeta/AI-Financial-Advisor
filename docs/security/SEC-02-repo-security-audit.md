# SEC-02 Repository Security Audit (Bank-Grade Review)

Date: 2026-02-12
Scope: Frontend (React/Vite), Supabase schema, FastAPI websearch/AI proxy service.

## Executive Summary

The repository has good foundational controls (RLS on core user tables, server-side OpenAI key handling, and basic rate limiting), but still carries **material production risk** in four areas:

1. **AI proxy endpoints are unauthenticated** and can be abused as an open LLM relay if exposed publicly.
2. **Provider error pass-through leaks internals** from upstream providers to clients.
3. **Database policy hardening gaps** existed for market data tables where RLS was not explicitly enabled.
4. **Dependency governance is weak** in the Python service because versions are unpinned.

## Findings

### Critical

#### 1) Unauthenticated AI relay endpoints
- File: `backend/websearch_service/app/routes/ai_proxy.py`
- Endpoints (`/api/chat`, `/api/chat/title`, `/api/ai/analyze-quantitative`) are callable without access-token verification.
- Impact:
  - Token theft by abuse (attacker burns your OpenAI quota/credits).
  - No user accountability beyond source IP.
  - Easy bot amplification if endpoint is internet-exposed.
- Recommendation:
  - Enforce JWT verification (Supabase JWT) at API gateway and app layers.
  - Bind requests to authenticated subject (`sub`) and remove client-supplied `user_id` from trust boundaries.

### High

#### 2) Upstream provider error body propagation
- Files:
  - `backend/websearch_service/app/routes/ai_proxy.py`
  - `backend/websearch_service/app/routes/search.py`
- Current behavior can return raw provider `response.text` to clients for non-200 responses.
- Impact:
  - Potential leakage of upstream metadata, internal hints, or provider-side diagnostics.
- Recommendation:
  - Return generic 502/503 style client messages.
  - Send detailed provider diagnostics only to server audit logs with redaction.

#### 3) Python dependencies are unpinned
- File: `backend/websearch_service/requirements.txt`
- Uses floating dependencies (`fastapi`, `uvicorn[standard]`, `httpx`) without versions.
- Impact:
  - Supply-chain and regression risk from silent upgrades.
  - Reduced reproducibility in CI/CD and incident response.
- Recommendation:
  - Pin versions and use a lock strategy (`pip-tools`, Poetry, or uv lock).
  - Add regular SCA scanning and patch windows.

### Medium

#### 4) In-memory rate limiter is single-instance and resettable
- File: `backend/websearch_service/app/routes/ai_proxy.py`
- Limiter is process-local in memory; distributed deployments can bypass limits.
- Impact:
  - Limited abuse resistance at scale.
- Recommendation:
  - Move to Redis or API gateway/WAF rate limits with per-user keys.

#### 5) Audit log may contain sensitive metadata indefinitely
- File: `backend/websearch_service/app/services/audit.py`
- JSONL logs can grow indefinitely and may include identifying metadata (`client_id`, `user_id`, token usage telemetry).
- Impact:
  - Privacy, retention, and storage risk.
- Recommendation:
  - Define retention + rotation (e.g., 30/90 days).
  - Apply at-rest encryption and restricted file permissions.

## Hardening Applied in This Change

1. Enabled RLS explicitly on:
   - `public.market_indices`
   - `public.trending_stocks`
   - `public.stock_snapshots`
2. Added authenticated read policy for `public.stock_snapshots`.

These changes reduce accidental overexposure risk if table grants are modified later.

## 30-Day Remediation Plan

1. Add authentication middleware for AI/search routes and enforce JWT validation.
2. Replace upstream error pass-through with sanitized errors + structured secure logging.
3. Introduce dependency pinning and automated SCA checks (npm + Python).
4. Move rate limiting to shared infrastructure (gateway/Redis) and add alerting.
5. Define audit-log retention, rotation, and restricted access policy.

## Validation Notes

- Manual code inspection performed across security-critical paths.
- `npm audit` could not complete in this environment due registry advisory endpoint 403.
