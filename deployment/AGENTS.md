# deployment/ — Deploy and infrastructure touchpoints

## Scope

- **In scope:** `deployment/**`, Dockerfiles referenced from docs, platform config snippets documented here.
- **Out of scope for autonomous edits:** live Vercel/Railway/Supabase settings — document diffs for humans to apply.

## Rules

- **Frontend:** Vite build outputs `dist/`; Node 20+; build command `npm run build` (see root `package.json` and `README.md`).
- **Backend:** Container build context `backend/websearch_service` (see CI docker-build job).
- **Secrets:** Never commit `.env` with real keys. Use `config/env.example` and `backend/websearch_service/.env.example` as templates only.

## Verification (local smoke)

- Docker Compose (when touching compose files):

```bash
docker-compose -f deployment/docker-compose.yml config
```

- Full stack bring-up is optional unless the task requires it; if used, follow `README.md` / `DEPLOYMENT.md`.

## Skills

- `skills/deployment-readiness/SKILL.md`
- `skills/architecture-compliance/SKILL.md` for cross-cutting boundary checks
