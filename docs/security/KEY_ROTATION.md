# Key-Rotation Runbook

**Owner:** TheEyeBeta · **Date:** 2026-07-16
**Rule:** never rotate a production key without explicit authorization from the
credentials owner (see `docs/readiness/OWNERSHIP.md`). Rotations below are
written to be executable during an incident (`docs/runbooks/suspected-key-leakage.md`).

General sequence for every key: **provision new → deploy new → verify → revoke
old → record**. Revoke-first only when actively exploited (accept the outage).
After any rotation, record: date, key, reason, rotator, verification evidence
(in the incident record or `docs/recovery/RECOVERY_EVIDENCE_TEMPLATE.md`).

## 1. Supabase service-role key

- **Used by:** Railway backend (`SUPABASE_SERVICE_ROLE_KEY`), GitHub Actions integration tests (test project only).
- **Rotate:** Supabase dashboard → Settings → API → roll `service_role` key.
- **Deploy:** update Railway env (staging + production services) → redeploy → `GET /health/ready` must return `ready` (its DB ping uses the key).
- **Verify:** readiness green; an authenticated chat round-trip works.
- **Blast radius if leaked:** full RLS bypass on all schemas — treat as SEV-1, rotate immediately, then audit data access via Supabase logs.

## 2. Supabase JWT secret

- **Used by:** backend JWT verification (`SUPABASE_JWT_SECRET`); Supabase signs all user tokens with it.
- **Rotate:** Supabase dashboard → Settings → API → JWT secret rotation. **This invalidates every active user session.**
- **Deploy:** update Railway env in the same window; users must re-authenticate.
- **Verify:** fresh sign-in works; old tokens are rejected (`app/services/auth.py` path).
- **Caution:** coordinate with a low-traffic window; announce forced sign-out if user-visible.

## 3. OpenAI API key

- **Used by:** backend only (`OPENAI_API_KEY`).
- **Rotate:** OpenAI dashboard → create new key (project-scoped) → update Railway env → redeploy → delete old key.
- **Verify:** `/health` reports `openai: ok`; one live chat turn succeeds on staging.
- **Also applies to:** `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`, DataAPI credentials — same pattern, verify via `/health/ready` search-provider status and trade-engine endpoints.

## 4. Google OAuth client secret

- **Used by:** Supabase Auth (configured in Supabase dashboard → Authentication → Providers → Google), not in this repo.
- **Rotate:** Google Cloud Console → create new client secret → paste into Supabase provider config → verify Google sign-in on staging → delete old secret in Google Console.
- **Caution:** keep both secrets valid during the switchover; deleting the old one first breaks all Google sign-ins.

## 5. Redis/Valkey credentials

- **Used by:** backend (`REDIS_URL`) for shared rate limits + WS tickets.
  Production runs [Valkey](https://valkey.io) (BSD-3-Clause Redis-protocol
  fork), not Redis Ltd.'s Redis — see `deployment/DEPLOYMENT.md`. The env
  var name and rotation steps are unchanged either way.
- **Rotate:** provider dashboard (Railway Valkey service) → new credentials → update `REDIS_URL` → redeploy.
- **Verify:** `/health/ready` `rate_limit` component `ok`; WS ticket round-trip.
- **Degradation note:** backend falls back to process-local state without Redis/Valkey (rate limits weaken with >1 replica) — rotate promptly but calmly. See `docs/runbooks/redis-unavailable.md`.

## 6. Sentry DSNs (frontend + backend)

- **Used by:** `VITE_SENTRY_DSN` (Vercel build env), `SENTRY_DSN` (Railway).
- **Rotate:** Sentry → project → Client Keys → create new, disable old. DSNs are not highly sensitive (write-only), but a leaked DSN allows event flooding.
- **Verify:** manual test event per `RUNBOOK.md`.

## 7. Vercel / Railway access tokens

- **Used by:** `RAILWAY_TOKEN` (GH secret, staging deploy). No Vercel token is currently required by workflows (production deploys are native integrations).
- **Rotate:** platform dashboard → new token → update GitHub repo secret → re-run `deploy-staging.yml` to verify.

## 8. GitHub credentials

- **Used by:** repo secrets consumed by workflows; fine-grained PATs if any exist outside Actions.
- **Rotate:** regenerate tokens; audit repo → Settings → Secrets for stale entries at every rotation.
- **Verify:** re-run the affected workflow.

## Ownership and cadence

| Key | Owner | Scheduled rotation |
| --- | --- | --- |
| Supabase service-role / JWT secret | `[OWNER — fill in]` | 180 days or on suspicion |
| OpenAI / Tavily / Perplexity / DataAPI | `[OWNER — fill in]` | 180 days |
| Google OAuth secret | `[OWNER — fill in]` | 365 days |
| Redis/Valkey | `[OWNER — fill in]` | 180 days |
| Sentry DSNs | `[OWNER — fill in]` | on suspicion |
| Railway/Vercel/GitHub tokens | `[OWNER — fill in]` | 90 days |

Status: procedures `IMPLEMENTED` (documented, reviewed against dashboards'
current menus where known); **no rotation rehearsal has been performed — each
procedure is `MANUAL VERIFICATION REQUIRED` until first executed and logged.**
