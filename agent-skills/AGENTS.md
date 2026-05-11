# agent-skills router (cross-tool task mapping)

This file helps agents map natural-language requests to existing repository skills.
It is additive and does not replace constitutional rules in `/AGENTS.md`.

## Use these skills first

- Chat pipeline debugging, streaming issues, provider/model behavior:
  `skills/chat-pipeline-debug/SKILL.md`
- Auth boundaries, JWT identity flow, RLS and Supabase exposure:
  `skills/auth-boundary-review/SKILL.md`
- CI or deployment-safe edits (without weakening checks):
  `skills/ci-cd-safe-change/SKILL.md`
- FastAPI endpoint implementation:
  `skills/backend-endpoint-implementation/SKILL.md`
- Frontend bug fixes:
  `skills/frontend-bugfix/SKILL.md`
- DB migration and policy safety:
  `skills/db-migration-safety-review/SKILL.md`
- Cross-layer architecture checks:
  `skills/architecture-compliance/SKILL.md`

## Router rules

1. Choose the narrowest matching skill.
2. If more than one skill applies, follow the higher-risk skill first (auth/DB beats UI).
3. Keep changes within the skill's allowed file scope.
4. Escalate to a human when a task requires production dashboard actions or security tradeoffs.
