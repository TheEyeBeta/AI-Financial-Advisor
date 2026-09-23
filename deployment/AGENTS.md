# deployment/ — Deploy and infrastructure touchpoints

## Scope

- **In scope:** `deployment/**`, Dockerfiles referenced from docs, platform config snippets documented here.
- **Out of scope for autonomous edits:** live Vercel/AWS/Supabase settings — document diffs for humans to apply.

## Rules

- **Frontend:** Vite build outputs `dist/`; Node 20+; build command `npm run build` (see root `package.json` and `README.md`).
- **Backend:** Container build context `backend/websearch_service` (see CI docker-build job). **Live production/staging deploy target is AWS EC2** — `deployment/aws/` (Docker Compose + Cloudflare Tunnel ingress) is the authoritative, currently-used deployment; `deployment/oracle/` is a documented alternative that was evaluated but never adopted, and Railway is fully decommissioned (both Railway projects deleted 2026-09). Do not resurrect Railway-specific config as the deploy target.
- **Secrets:** Never commit `.env` with real keys. Use `config/env.example` and `backend/websearch_service/.env.example` as templates only. Production/staging DB URLs and AWS/SSH credentials live in GitHub Environment secrets (`aws-production`, `main-staging`) — see `deployment/aws/README.md`'s secrets table; never write these to a committed file.

## Verification (local smoke)

- Docker Compose (when touching compose files):

```bash
docker-compose -f deployment/docker-compose.yml config
```

- Full stack bring-up is optional unless the task requires it; if used, follow `README.md` / `DEPLOYMENT.md`.

## Skills

- `skills/deployment-readiness/SKILL.md`
- `skills/architecture-compliance/SKILL.md` for cross-cutting boundary checks
- `skills/aws-cli-ops/SKILL.md` for EC2/SSM/CloudWatch/EventBridge operations against the live AWS infra (once added — see `skills/INDEX.md`)
