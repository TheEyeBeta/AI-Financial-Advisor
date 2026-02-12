# SEC-03 Joint Blue Team / Red Team / AppSec Assessment

Date: 2026-02-12
Scope: `src/`, `backend/websearch_service/`, `sql/schema.sql`

## Blue Team View (Defensive Operations)

### What is working
- Core user-data tables have RLS enabled and ownership-based policies in place.
- LLM provider keys are handled server-side in the websearch service.
- Basic abuse controls exist (in-memory rate limiting + audit logging for AI routes).

### Immediate monitoring priorities
1. Alert on spikes in `/api/chat`, `/api/chat/title`, `/api/ai/analyze-quantitative`.
2. Alert on repeated 429 and 5xx bursts (potential probing / abuse).
3. Add dashboards for AI token usage anomalies per source/IP/user.

### Blue Team hardening backlog
- Move from local JSONL audit logs to centralized immutable logging.
- Add log rotation + retention and data minimization rules.
- Enforce endpoint auth at gateway and app layers.

## Red Team View (Adversarial Testing)

### Top likely attack paths
1. **Open AI relay abuse**: unauthenticated AI routes can be scripted for quota theft / cost amplification.
2. **Error-intel harvesting**: provider error-body pass-through may leak useful diagnostics for chaining attacks.
3. **Rate-limit bypass in horizontal scaling**: process-local limiter can be bypassed across replicas.
4. **Supply-chain drift**: unpinned Python deps can introduce vulnerable transitive updates.

### Red Team test cases to run
- Credential-less fuzzing of all `/api/*` endpoints for unauthorized usage.
- High-concurrency distributed traffic to validate limit enforcement behavior.
- Malformed payload injection to inspect error leakage quality.
- Dependency tampering simulation in CI to validate lockfile integrity checks.

## AppSec View (Secure SDLC / Policy)

### Findings alignment
- The architecture is directionally sound but misses production-grade controls expected for bank workloads:
  - Strong authN/authZ on AI proxy APIs.
  - Sanitized external error handling.
  - Deterministic dependency management.
  - Centralized logging and retention controls.

### Priority remediation plan (P0/P1)
- **P0**: Add JWT verification middleware for AI/search APIs and remove trust in client-supplied identity fields.
- **P0**: Replace provider error pass-through with sanitized user-safe messages.
- **P1**: Migrate rate limiting to gateway/Redis and enforce per-principal quotas.
- **P1**: Pin Python dependencies and add SCA gates in CI.

## Policy Consistency Fix Applied

To preserve intended "public read" behavior after enabling RLS, market data policies now include both `authenticated` and `anon` roles for:
- `public.market_indices`
- `public.trending_stocks`

This aligns behavior with existing `news_articles` public-read policy intent.
