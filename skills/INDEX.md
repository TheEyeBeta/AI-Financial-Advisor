# Skills index (task → playbook)

Use the **narrowest** skill that fits. Each skill lists its own preconditions and verification.

| Situation | Skill |
|-----------|--------|
| New FastAPI route or public API change | `backend-endpoint-implementation` |
| React/UI defect, state bug, or test failure in `src/` | `frontend-bugfix` |
| Alembic revision, migration review, upgrade ordering | `db-migration-safety-review` |
| RLS, grants, JWT/auth flow, Supabase exposure | `supabase-rls-auth-review` |
| Auth boundary checks across layers (JWT, role gating, tenant isolation) | `auth-boundary-review` |
| AI advisor prompt, streaming, classifier, proxy behavior | `ai-chat-pipeline-change` |
| Chat pipeline debugging (streaming/provider/timeout regressions) | `chat-pipeline-debug` |
| Repository health / dependency / CI inventory | `repo-audit` |
| Boundary and invariant enforcement across layers | `architecture-compliance` |
| Release checklist: env, build, migrations, CI | `deployment-readiness` |
| CI/CD-safe changes without weakening quality gates | `ci-cd-safe-change` |
| Governance: design or audit agent instruction layers (`AGENTS.md`, `CLAUDE.md`, skills) | `instruction-stack-steward` |

Constitutional rules: `/AGENTS.md`  
Claude workflow: `/CLAUDE.md`
