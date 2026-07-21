# Google Authentication — Enablement Checklist (DEFERRED)

Google OAuth stays **disabled** until password authentication is independently
verified in staging (per the readiness plan). This is the pre-enablement
validation + configuration checklist; enablement itself is an EXTERNAL action in
the Supabase + Google Cloud consoles.

## Preconditions (must be green first)
- [ ] Password auth verified end-to-end in staging (sign-up, sign-in, sign-out, refresh, expiry).
- [ ] Backend JWT verification covers Supabase-issued Google-provider tokens (same `iss`, ES256/JWKS path — already tested by `test_es256_service_role_jwt_uses_supabase_jwks`).
- [ ] Env validator green for staging (`python -m app.env_validation`).

## Configuration validation (repo-side, no secrets committed)
- [ ] `GOOGLE_OAUTH_CLIENT_ID` present in the deploy env (never in `VITE_*`, never committed).
- [ ] `GOOGLE_OAUTH_CLIENT_SECRET` stored only in the Supabase Auth provider config (server side).
- [ ] Redirect URLs restricted to the exact staging/production origins (match `CORS_ORIGINS` / `TRUSTED_HOSTS`).
- [ ] Profile provisioning on first Google sign-in creates a `core.users` row (see migration `0027_google_oauth_profile_provisioning`).
- [ ] Account-linking policy decided (same email via password + Google) — documented before enablement.

## Enablement (EXTERNAL — console steps)
1. Google Cloud: create OAuth 2.0 client, set authorised redirect URIs to the Supabase callback.
2. Supabase Auth → Providers → Google: paste client ID/secret, restrict redirect URLs.
3. Enable provider in staging first; run the sign-in smoke journey (`auth-google-real-account`).
4. Only after staging passes: enable in production; re-run env validator + smoke.

## Post-enablement verification
- [ ] `auth-google-real-account` journey passes (MANUAL — real provider).
- [ ] Redaction check: no OAuth `client_secret` or tokens in logs (covered by `test_log_redaction.py`).
- [ ] Rotation entry added to `docs/security/KEY_ROTATION.md` (closeout).
