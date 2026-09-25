---
name: vercel-cli-ops
description: >-
  Operates this repository's live Vercel frontend project through the Vercel
  CLI/MCP: environment variables, preview/staging deployments, deployment
  inspection and rollback, and CSP/domain drift checks. Use only for the
  verified project `ai-financial-advisor` under scope `the-eye-betas-projects`.
  Do not use for generic Vercel platform design or unapproved production
  deploy changes.
---

# Skill: vercel-cli-ops

## When to use

- Inspecting or updating Vercel Preview/Production environment variables (e.g. `VITE_PYTHON_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Provisioning or redeploying a Preview deployment pointed at a specific backend URL (mirrors what `deploy-staging.yml`'s `run_e2e: true` path does automatically).
- Inspecting deployment history, build logs, or runtime/edge logs for a live issue.
- Checking that `vercel.json`'s CSP `connect-src`/domain config matches the current backend origin, and that it agrees with `index.html`'s CSP `<meta>` tag (both are enforced simultaneously by the browser — see "CSP drift" below).
- Rolling back or promoting a specific prior deployment when a bad production deploy needs a fast, human-approved revert.

## Do not use for

- Generic Vercel product/platform advice unrelated to this project.
- Changing Vercel project settings that aren't documented here (billing, team membership, integrations, domain DNS) — those are dashboard-only per root `AGENTS.md` §"Production platform dashboards."
- Routine production deploys — this repo's production frontend deploys via **Vercel's native GitHub integration** on push to `main` (`deployment/DEPLOYMENT.md`), not the CLI. Do not `vercel deploy --prod` as a substitute for that integration without explicit human instruction.
- Treating a documented command as blanket permission to mutate live environment variables or trigger a production deployment.

## Risk classification

**Medium-High** — mutating Preview/Production env vars or deploying can break the live frontend or silently point it at the wrong backend (this repo already hit a real production outage from CSP drift between `vercel.json` and `index.html` — see `deployment/aws/README.md` and the fix history). Read operations are low risk; env-var/deploy mutations require the same current-task human go-ahead as any other production-affecting change under root `AGENTS.md`.

## Repository-verified values

| Item | Verified value |
|---|---|
| Vercel project name | `ai-financial-advisor` |
| Vercel team scope | `the-eye-betas-projects` |
| `.vercel/project.json` (gitignored, present on a linked machine) | `projectId: prj_j8036672J9iq37XnxTgfL22l54RP`, `orgId: team_tyOFheBoMqtsJBfkuV5GuMRT` |
| Framework | Vite (`vercel.json`: `framework: "vite"`, `outputDirectory: "dist"`) |
| Frontend key env vars | `VITE_PYTHON_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (never a service-role key — root `AGENTS.md`: no model/provider/service-role secrets in `VITE_*`) |
| CLI usage precedent | `.github/workflows/deploy-staging.yml` (`link --project ai-financial-advisor --scope the-eye-betas-projects`, `env rm`/`env add ... preview`, `deploy`) — Preview environment only, never Production |
| GitHub secret | `VERCEL_TOKEN` (used only by `deploy-staging.yml`'s `run_e2e: true` path) |

If live Vercel CLI/MCP output disagrees with the table above (different project name, different scope, unexpected env var), **stop mutating operations, record the discrepancy, and report documentation drift**. Never invent a project ID, org ID, or env var name.

## Required reading

Before operating Vercel:

- Root `AGENTS.md` — "Production platform dashboards and infra" (no changes from agents without human-run steps or explicit human go-ahead).
- `deployment/AGENTS.md` — "Out of scope for autonomous edits: live Vercel/AWS/Supabase settings."
- `deployment/DEPLOYMENT.md` §"Frontend Deployment (Vercel)" and §"Rollback Procedures".
- `deployment/aws/README.md` §4 ("Point the frontend at the new backend") — the CSP drift lesson.
- `.github/workflows/deploy-staging.yml` — the only place this repo currently scripts Vercel CLI mutations.
- `vercel.json` and `index.html` — the two places CSP is defined; they must agree.
- `skills/instruction-stack-steward/SKILL.md` when changing this skill or other governance files.

## Preflight

Every Vercel CLI session starts with project identity verification.

~~~bash
npx --yes vercel@latest whoami --token="$VERCEL_TOKEN"
npx --yes vercel@latest project ls --token="$VERCEL_TOKEN" --scope the-eye-betas-projects
~~~

**Hard gate:** do not run mutating commands (`env add`, `env rm`, `deploy`, `rollback`, `promote`) unless the project resolved is `ai-financial-advisor` under scope `the-eye-betas-projects`. If the CLI is not linked locally, `vercel link --yes --project ai-financial-advisor --scope the-eye-betas-projects --token="$VERCEL_TOKEN"` first.

If a Vercel MCP tool is available in the session (per the connected `claude.ai Vercel` MCP server), prefer it for read operations (list deployments, get deployment, list project env) over shelling out to the CLI — but the same project/scope verification applies before any write call (`create_deployment`, `edit_project_env`, `create_project_env`).

## Environment variables

### Inspect

~~~bash
npx --yes vercel@latest env ls --token="$VERCEL_TOKEN" --scope the-eye-betas-projects
~~~

Or via MCP: `list_project_env` / `get_project_env`, filtered to the `ai-financial-advisor` project.

### Mutate (Preview only, unless explicitly authorized for Production)

Removing then re-adding is this repo's established pattern (`deploy-staging.yml`) because Vercel's CLI does not support an in-place update for a scoped env var:

~~~bash
npx --yes vercel@latest env rm VITE_PYTHON_API_URL preview --yes --token="$VERCEL_TOKEN"
printf '%s' "$NEW_BACKEND_URL" | npx --yes vercel@latest env add VITE_PYTHON_API_URL preview --token="$VERCEL_TOKEN"
~~~

**Never echo a secret value into shell history or a command that gets logged.** Pipe it in via `printf`/stdin as shown, not as a bare CLI argument, and never print `env ls` output for a variable that might carry a real credential.

Mutating a **Production** env var (`VITE_PYTHON_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` under the `production` target) requires explicit current-task human approval — this is what actually pointed prod at AWS during the Railway migration (`deployment/aws/README.md` §4) and is not a routine operation.

After any Production env var change, a **new Production deployment must be triggered** for it to take effect (env vars are baked in at Vite build time, not read at runtime) — either via the native GitHub integration (push/redeploy) or `vercel deploy --prod`, with the same human approval covering the deploy as covered the env change.

## Deployments

### List and inspect

~~~bash
npx --yes vercel@latest ls --token="$VERCEL_TOKEN" --scope the-eye-betas-projects
npx --yes vercel@latest inspect <deployment-url-or-id> --token="$VERCEL_TOKEN"
~~~

Or via MCP: `list_deployments`, `get_deployment`, `get_deployment_file_contents`, `get_runtime_logs`, `get_runtime_errors`.

### Preview deploy (staging/manual verification)

Mirrors `deploy-staging.yml`:

~~~bash
npx --yes vercel@latest link --yes --token="$VERCEL_TOKEN" --project ai-financial-advisor --scope the-eye-betas-projects
DEPLOY_URL=$(npx --yes vercel@latest deploy --token="$VERCEL_TOKEN" --yes)
~~~

This creates a **Preview** deployment. A bare `vercel deploy` without `--prod` never touches the live production alias.

### Production deploy or rollback — human-gated

- Routine production deploys happen through the native GitHub integration on push to `main`. Do not run `vercel deploy --prod` as a substitute unless a human explicitly asks for an out-of-band production deploy (e.g. an emergency env-var-only fix that can't wait for a merge).
- Rollback: use the Vercel dashboard (`deployment/DEPLOYMENT.md` §"Frontend (Vercel)" rollback procedure — "select the previous deployment, and roll back or promote it") or `vercel rollback <deployment-url>` / `promote`/`request_rollback` via MCP, only with explicit human instruction naming the exact deployment to roll back to.

## CSP drift — check both locations together

This repo has a documented production incident where `vercel.json`'s HTTP-header CSP `connect-src` was updated for a new backend origin but `index.html`'s `<meta http-equiv="Content-Security-Policy">` was not — browsers enforce the **intersection** of both, so requests were silently blocked despite the header looking correct.

Whenever a backend origin, WebSocket origin, or third-party API domain changes in `connect-src` (or any other CSP directive):

1. Update `vercel.json`'s `headers[].headers[]` CSP value.
2. Update `index.html`'s CSP `<meta>` tag with the **same** directive value.
3. Verify both files agree with a diff-style read of both, not just one.
4. After deploy, verify in an actual browser (a genuine incognito window, not a cache-busted reload) that the network requests succeed — a green CI/E2E run does not prove this, since Playwright's browser context may not replicate real CSP enforcement identically to a fresh user session.

Do not remove a stale domain from CSP (e.g. a decommissioned Railway origin) without confirming nothing still depends on it; conversely, do not leave a stale domain in place indefinitely — flag it for cleanup if found.

## Forbidden actions

Without explicit human go-ahead in the **current task**, do not:

- push a Production env var change or trigger a Production deployment;
- remove or rotate `VERCEL_TOKEN`;
- change Vercel project settings outside env vars/deployments (domains, billing, team membership, integrations);
- put a model/provider/service-role secret into any `VITE_*` variable;
- roll back or promote a Production deployment;
- disable or bypass the native GitHub integration's deploy-on-push-to-`main` behavior.

Never interpret this skill's existence as authorization.

## Stop conditions

Stop mutating operations and report when:

- the resolved project is not `ai-financial-advisor` or the scope is not `the-eye-betas-projects`;
- `VERCEL_TOKEN` is missing/expired/rejected;
- an expected env var or deployment cannot be found;
- live Vercel state materially disagrees with repo docs (different framework, different build output dir, undocumented env var);
- the operation requires a Production mutation without current-task approval;
- CSP would be updated in only one of `vercel.json`/`index.html`.

## Done when

- Project/scope identity verified before any mutation.
- The narrowest required operation completed (Preview env/deploy unless Production was explicitly authorized).
- Post-state verified (env var present with correct value's *length/presence*, not printed in full if sensitive; deployment reachable and serving the expected build).
- If CSP directives changed, both `vercel.json` and `index.html` were updated and confirmed to match.
- Any repo-vs-live drift is reported.

## Required evidence in the final response

1. **What was operated** — project, environment (preview/production), purpose.
2. **Identity** — project name and scope verified.
3. **Commands run** — CLI or MCP calls actually executed.
4. **Before/after state** — env var presence/target, deployment URL/status.
5. **CSP consistency** — confirmed matching, if touched.
6. **Human follow-up** — unresolved approval, missing token, or documentation repair.
