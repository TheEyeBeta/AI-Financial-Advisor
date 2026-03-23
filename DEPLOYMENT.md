# Deployment Guide

## Authentication Migration: X-Admin-Key to Service-Role JWT

### What changed

The static `X-Admin-Key` header authentication for admin endpoints has been
replaced with **Supabase service-role JWT** verification.  Admin endpoints now
accept authentication through:

1. **Service-role JWT** (preferred for automation/CI) — a Supabase-issued JWT
   whose `role` claim is `service_role`, verified locally using `SUPABASE_JWT_SECRET`.
2. **User JWT** (for the admin UI) — a standard Supabase user JWT, validated
   via the Supabase REST API, where the user must have `userType = 'Admin'` in
   the `core.users` table.

The `X-Admin-Key` header is no longer accepted.  Remove the `ADMIN_API_KEY`
environment variable from all deployments.

### Why

Static API keys are a security liability:

- They cannot be scoped, rotated automatically, or audited per-caller.
- They are easily leaked in logs, shell history, or CI config.
- JWTs provide built-in expiry, role claims, and signature verification.

### Configuring `SUPABASE_JWT_SECRET`

1. Open the **Supabase Dashboard** for your project.
2. Navigate to **Settings > API**.
3. Copy the **JWT Secret** value.
4. Set it as the `SUPABASE_JWT_SECRET` environment variable on every backend
   deployment (Railway, Render, Docker, etc.).

This secret is used to verify both user JWTs (`require_auth`) and service-role
JWTs (`verify_service_role`) locally, without a network round-trip to Supabase
on every request.

### Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_JWT_SECRET` | **Yes** | Supabase project JWT secret (HS256 signing key) |
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI chat |
| `TAVILY_API_KEY` | Yes | Tavily API key for web search |
| `CORS_ORIGINS` | Yes (prod) | Comma-separated allowed frontend origins |
| `ENVIRONMENT` | Recommended | `production`, `staging`, or `development` |
| `SUPABASE_URL` | Recommended | Supabase project URL (for user-JWT admin fallback) |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Supabase service-role key (for DB queries) |
| `PERPLEXITY_API_KEY` | Optional | Fallback LLM when OpenAI hits rate limits |

### Migration Checklist

- [ ] Set `SUPABASE_JWT_SECRET` in all backend environments
- [ ] Remove `ADMIN_API_KEY` from all environments
- [ ] Update any CI/CD scripts that sent `X-Admin-Key` headers to use
      `Authorization: Bearer <service-role-jwt>` instead
- [ ] Verify admin endpoints work with the new auth by calling
      `GET /api/admin/system-health` with a service-role JWT

### Generating a Service-Role JWT for Testing

The Supabase service-role key (found in Dashboard > Settings > API) is itself
a valid JWT with `role: service_role`.  You can use it directly:

```bash
curl -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     https://your-backend.example.com/api/admin/system-health
```

## DAST Scanning

A weekly OWASP ZAP baseline scan runs via `.github/workflows/dast.yml`.

- **Schedule**: Every Monday at 06:00 UTC.
- **Manual trigger**: Use the "Run workflow" button in GitHub Actions.
- **Target**: Set the `STAGING_URL` repository secret to your staging URL.
- **Reports**: Uploaded as a GitHub Actions artifact (`zap-report`).
- **Issues**: A GitHub issue is created automatically when high-severity
  findings are detected.
- **Rules**: `.github/zap-rules.tsv` suppresses known false positives.
