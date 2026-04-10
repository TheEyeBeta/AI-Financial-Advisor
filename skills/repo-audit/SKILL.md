# Skill: repo-audit

## When to use

- Periodic **health check** of engineering hygiene: CI truth vs `package.json` scripts, workflow coverage, dependency audits.
- Comparing **documentation** (`README.md`, `deployment/DEPLOYMENT.md`) to actual commands and paths after refactors.
- Preparing a **risk-ranked** list of findings for humans (no code changes required).

## Do not use for

- Implementing feature work or large refactors (use the appropriate implementation skill).
- Changing production cloud settings without human execution.

## Risk classification

**Low** when read-only; **Medium** if you propose workflow or dependency edits (treat proposals as separate reviewed changes).

## Allowed files and paths

- Read across the repository as needed.
- Write only when the task explicitly includes fixes; otherwise **output findings** in the agent response without touching files.

## Required reading (before conclusions)

- `.github/workflows/ci.yml`, `lint.yml`, `security.yml`
- Root `package.json` scripts
- `backend/websearch_service/requirements.txt`
- `AGENTS.md` (constitutional commands)

## Workflow (ordered)

1. Inventory CI jobs and the **exact commands** they run; map each to a local equivalent.
2. Compare advertised developer flows in `README.md` to real scripts (OpenAPI drift check, Alembic, pytest coverage thresholds).
3. Spot-check **high-risk modules**: `app/services/auth.py`, `app/routes/ai_proxy.py`, Supabase client code.
4. Produce a **prioritized** finding list: severity, evidence path, suggested owner or next action.

## Commands (run as needed; mirror CI where possible)

```bash
npm run validate
```

```bash
npm audit --omit=dev --omit=optional --audit-level=high
```

```bash
python -m pip install --upgrade pip pip-audit
pip-audit -r backend/websearch_service/requirements.txt
```

```bash
python -m pip install --upgrade pip bandit
bandit -r backend/websearch_service/app -ll
```

Note: `npm run validate` runs `lint:ci`, `type-check`, and `test` per `package.json`; CI also runs `test:coverage` and `build` in `ci.yml`. Mention any gaps between local habits and CI.

## Forbidden actions

- Dismissing security findings without citing workflow evidence.
- Auto-merging dependency bumps without review and test runs.

## Done when

- The final response includes a table or ordered list of findings with **file paths and workflow names** as evidence.
- Each finding has **severity** and a **concrete** next step.

## Required evidence in the final response

- Commands executed (or explicit statement that the audit was documentary-only).
- CI vs local command gaps, if any.
- Top five risks maximum for readability; deprioritize noise.
