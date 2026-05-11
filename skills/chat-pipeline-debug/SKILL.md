---
name: chat-pipeline-debug
description: >-
  Diagnose and fix backend AI chat pipeline issues (routing, streaming, model/provider
  configuration, and guardrails) without weakening auth or safety controls.
---

# Skill: chat-pipeline-debug

## When to use

- Streaming stalls, truncated responses, or malformed chat payloads.
- Model/provider routing regressions in AI proxy behavior.
- Prompt or classifier changes that affect advisor responses.

## Do not use for

- Frontend-only rendering/state bugs (use `frontend-bugfix`).
- Non-chat API endpoint work (use `backend-endpoint-implementation`).
- DB/RLS policy changes (use `supabase-rls-auth-review` or `db-migration-safety-review`).

## Primary procedure

Use `skills/ai-chat-pipeline-change/SKILL.md` as the authoritative workflow for:

- Allowed paths and required reading.
- Mandatory backend/OpenAPI verification commands.
- Forbidden actions and required final evidence.

## Extra debug checklist

1. Confirm auth headers and request identity propagate to the backend route.
2. Trace the request from route handler to provider call and back to stream writer.
3. Validate timeout, token-limit, and fallback settings against existing config.
4. Verify logs do not include secrets, tokens, or raw sensitive payloads.
