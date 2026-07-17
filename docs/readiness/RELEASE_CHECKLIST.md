# Release Checklist — enforceable, per production release

**Owner:** TheEyeBeta · **Created:** 2026-07-16 (Phase 9)
Copy this checklist into the staging→main promotion PR description and check
every box **with the evidence link** — an unchecked or evidence-free box means
the release is not eligible. Policy: `RELEASE_POLICY.md`.

```markdown
## Release: <version/date>
- Release SHA (exact, full): `________________________________________`
- Rollback target SHA (previous good): `________________________________`

### Gates (all mandatory)
- [ ] All mandatory checks green on this SHA (link the checks page)
      — list per RELEASE_POLICY.md §2; a red or skipped-mandatory check disqualifies.
- [ ] Migrations reviewed: revisions in this release listed here: `______`
      (empty = "none"); reviewer confirms upgrade order + downgrade notes.
- [ ] Backup confirmed: Supabase backup/PITR point verified to exist NOW
      (dashboard screenshot or timestamp), not assumed.
- [ ] Environment changes documented: new/changed env vars listed here with
      the dashboard they were applied to: `______` (empty = "none").
- [ ] Staging deployment green: deploy-staging.yml run link: `______`
- [ ] Staging E2E green: e2e job link on the same run: `______`
- [ ] Staging release verification: release-verification.yml run link
      showing frontend+backend BOTH serve THIS SHA (full 40-char match,
      verdict "pass" in the uploaded `release-verification-evidence.json`
      artifact — a partial run checking only one component does not count):
      `______`
- [ ] Security-sensitive changes reviewed: does this release touch auth, RLS,
      rate limiting, WebSockets, CSP, or the AI proxy? If yes, second review
      recorded by: `______` (if no second human is available, a written
      self-review against docs/security/THREAT_MODEL.md is the floor).
- [ ] AI prompt/model changes: eval report attached per
      backend/websearch_service/evals/README.md (or "no AI changes").
- [ ] Monitoring checked pre-deploy: Sentry (both projects) at baseline;
      no active incident (INCIDENT_SEVERITY.md hard rule).

### Post-merge (production)
- [ ] Production deployments completed (Vercel + Railway show this SHA).
- [ ] release-verification.yml run against PRODUCTION urls (workflow_dispatch
      with `frontend_url`/`backend_url` inputs; requires production
      hostnames already present in the `RELEASE_ALLOWED_HOSTS` repository
      variable — see RELEASE_POLICY.md §5/§7): link showing verdict "pass"
      and the evidence artifact: `______`
- [ ] Post-deployment smoke: sign-in, one chat turn, paper-trading read,
      academy load — performed by `______` at `______` UTC.
- [ ] /health/ready: ready=true, degraded explained or false. Link/paste.
- [ ] Monitoring re-checked +30 min: error rates baseline.

Release approved by: `______` (owner per OWNERSHIP.md)
```

Notes:
- "Technically enforceable" boxes (CI checks, branch ruleset) are enforced by
  GitHub once the ruleset in `RELEASE_POLICY.md` §5 is applied
  (`EXTERNAL ACCESS REQUIRED` until confirmed). The rest are human-enforced —
  the promotion PR is the audit record.
- A failed post-deployment smoke triggers `../runbooks/production-rollback.md`,
  not a shrug.
