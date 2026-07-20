# Secret scanning and credential response

**Owner:** TheEyeBeta · **Last verified:** 2026-07-13 · **Scope:** issue #209 (audit M-07)

## What runs

- **Scanner:** [gitleaks](https://github.com/gitleaks/gitleaks) via `gitleaks/gitleaks-action`
  (pinned by commit SHA) in `.github/workflows/security.yml`, job `secret-scan`.
- **When:** every pull request and every push to `main`/`develop`.
- **Depth:** the checkout uses `fetch-depth: 0`, so pushes are scanned across the
  full commit history reachable from the ref — the first run on a branch is a
  full-history audit, not just a diff scan.
- **Config:** `.gitleaks.toml` extends the default ruleset. The only allowlisted
  items are deliberate fake fixtures (the public jwt.io example token used by
  the telemetry redaction tests, and zero-entropy `xxxx…` placeholders in env
  templates). Never allowlist a real credential "temporarily".
- **Output:** findings are uploaded as a redacted workflow artifact and job
  summary. Secret values are not printed to logs.

## If the scanner finds a secret

Deleting the string from the file is **not** remediation — the value remains in
git history and in any clone/cache. Follow all steps:

1. **Revoke/rotate first.** Rotate the credential at its provider
   (Supabase dashboard → API keys / JWT secret; OpenAI/Tavily/Perplexity
   dashboards; Valkey provider). Assume the old value is compromised.
2. **Deploy the new value** to the affected environments (Railway/Vercel env
   vars — human dashboard step per `AGENTS.md` §3).
3. **Remove the string from the tree** in a normal commit.
4. **Decide on history rewrite.** For high-value secrets in a public repo,
   rewriting history is usually not worth it once the credential is dead;
   prefer rotation + documenting the incident. If a rewrite is required, it is
   a human-approved operation (force-push coordination).
5. **Record the incident** (what leaked, when, rotation timestamp, affected
   systems) in the ops log / an issue.

## Frontend env-var policy

Anything in a `VITE_*` variable ships to every browser and is public by
definition. Only the Supabase URL + anon key, backend URLs, PostHog key, and
Sentry DSN belong there (all designed-public). Backend startup refuses
`VITE_SUPABASE_SERVICE_ROLE_KEY` in production (`app/services/auth.py`,
`validate_auth_configuration`).
