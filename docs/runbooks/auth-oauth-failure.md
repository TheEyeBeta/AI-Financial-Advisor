# Runbook: Authentication / OAuth failure

**Rehearsed:** NO

- **Trigger:** sign-in failures spiking (Sentry frontend auth errors); Google callback errors; JWT verification failures in backend logs.
- **Severity:** SEV-2 (all auth) / SEV-3 (Google only — email/password still works, and vice versa).
- **User impact:** users cannot sign in or sessions rejected.

## Immediate containment
1. Split the failure: email/password vs Google vs backend-JWT-verification. Test each on staging first, then production with a test account.
2. If only Google fails: email/password remains a workaround — communicate it.
3. **Never** relax `AUTH_REQUIRED`/JWT verification to restore service (AGENTS.md hard rule).

## Diagnostics
```bash
curl -s https://<backend>/health/ready | jq '.components.configuration'   # JWT secret present?
```
- Backend logs: `app/services/auth.py` rejection reasons (expired vs signature vs malformed).
- Supabase dashboard → Authentication → Logs (provider errors, rate limits).
- Google Cloud Console → OAuth consent/client status (secret expiry, consent screen suspension).
- Frontend: `?error=` params on /auth/callback are surfaced with recoverable messages (`src/lib/auth-callback.ts`).

## Dashboards / logs
Supabase Auth logs; Sentry both projects; Google Cloud Console.

## Recovery
- **JWT signature failures after a Supabase change:** the JWT secret rotated — update Railway `SUPABASE_JWT_SECRET` (`KEY_ROTATION.md` §2); all sessions re-authenticate.
- **Google secret expired/revoked:** rotate per `KEY_ROTATION.md` §4.
- **Supabase Auth incident:** wait; status.supabase.com.
- **Redirect-URI mismatch after a domain change:** fix authorized redirect URIs in Google Console + Supabase provider config.

## Rollback
If triggered by a frontend auth-flow deploy, roll back frontend (`production-rollback.md`).

## Validation
Fresh email sign-in, fresh Google sign-in, session refresh, and one authenticated backend call all succeed; Sentry auth-error rate at baseline.

## Communication
SEV-2 cadence; name the working alternative path if one exists.

## Post-incident
Add the failed leg to the release checklist smoke if it wasn't covered; check journey matrix rows (auth-*) still reflect reality.
