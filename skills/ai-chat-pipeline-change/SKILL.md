# Skill: ai-chat-pipeline-change

## When to use

- Editing `backend/websearch_service/app/routes/ai_proxy.py` (models, streaming, prompts, routing).
- Changing supporting services directly used by the AI proxy (for example `subagents`, `meridian_context`, `market_context`, `audit`, rate limiting hooks) when behavior affects chat, classification, or tool use.
- Adjusting environment-driven **model names**, token limits, or timeouts for OpenAI or fallback providers **in backend configuration**.

## Do not use for

- Unrelated FastAPI endpoints (use `backend-endpoint-implementation`).
- Frontend-only chat UI fixes without proxy contract changes (use `frontend-bugfix`).
- Database policy work (use `supabase-rls-auth-review` / `db-migration-safety-review`).

## Risk classification

**High** — cost spikes, latency regressions, compliance and “not financial advice” guardrails, accidental logging of secrets or PII, auth bypass on streamed routes.

## Allowed files and paths

- `backend/websearch_service/app/routes/ai_proxy.py`
- `backend/websearch_service/app/services/**` files that are **directly imported** by the proxy path you are changing
- `backend/websearch_service/tests/**`
- `docs/openapi.json` and `src/lib/generated/api-types.ts` **only** if the HTTP contract changes, via regeneration

## Required reading (before edits)

- `backend/websearch_service/AGENTS.md` and `app/services/auth.py` for auth requirements on AI routes.
- Existing tests covering streaming, errors, or rate limits if present.
- `app/services/audit.py` expectations if audit logging is involved.

## Workflow (ordered)

1. Map the request path: client headers (including `Authorization`), handler entry, external API calls, streaming response, audit/rate-limit hooks.
2. Preserve **authentication** and **rate limiting** behavior unless the task includes an explicit product decision documented in writing (escalate if unclear).
3. Avoid logging **raw tokens**, API keys, or full user messages in new log lines unless existing audited patterns already do so; prefer structured metadata without secrets.
4. Keep financial-disclaimer and educational positioning consistent with existing prompts unless product explicitly directs a change.
5. If HTTP response schemas or paths change, regenerate OpenAPI and TypeScript types; run the full frontend verification gate.

## Commands (mandatory)

```bash
cd backend/websearch_service
pytest tests/ -v --cov=app --cov-branch --cov-fail-under=80
```

If OpenAPI contract changed:

```bash
python backend/websearch_service/export_openapi.py
npm run generate:api-types
git diff --exit-code docs/openapi.json src/lib/generated/ || exit 1
npm run lint:ci
npm run type-check
npm run test
npm run build
```

## Forbidden actions

- Removing or bypassing auth checks on production-exposed routes in committed code.
- Moving provider API keys to the frontend or `VITE_*` variables.
- Silencing audit or rate-limit integration without replacement controls and human approval.

## Done when

- Backend tests pass with coverage thresholds intact.
- OpenAPI and frontend checks pass whenever the HTTP surface changed.
- Risk notes cover cost, latency, and logging/safety impacts when relevant.

## Required evidence in the final response

- Which proxy paths or behaviors changed.
- Pytest outcome; OpenAPI regeneration outcome if applicable.
- Any new env vars or deploy-time configuration operators must set.
