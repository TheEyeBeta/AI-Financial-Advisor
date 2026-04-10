---
name: instruction-stack-steward
description: >-
  Designs, audits, or updates this repository’s AI agent instruction hierarchy
  (AGENTS.md, CLAUDE.md, skills). Use when restructuring governance docs,
  onboarding new instruction layers, or syncing agent rules after refactors.
  Do not use for feature or product implementation.
---

# Skill: instruction-stack-steward

## When to use

- **Designing or restructuring** the layered instruction system (root vs local `AGENTS.md`, `CLAUDE.md`, `skills/`).
- **Auditing** governance docs against the real repo (paths, CI commands, auth/migration rules) after a significant move or rename.
- **Adding or retiring** a skill playbook, or splitting overly long root instructions into a skill **without** weakening constraints.
- **Reconciling** duplicate or conflicting agent guidance discovered in docs or rules files.

## Do not use for

- Implementing application features, bugs, or refactors in `src/` or `backend/websearch_service/` (use the narrow implementation skills in `skills/INDEX.md`).
- Changing production cloud dashboards, secrets, or live Supabase settings.
- One-off coding tasks where `AGENTS.md` and the relevant local `AGENTS.md` plus one skill already suffice.

## Risk classification

**Medium** — mistakes here propagate bad behavior to every future agent run (auth drift, wrong verification commands, invented paths). Treat edits as **high scrutiny**.

## Repository ground truth (do not invent)

Instruction layers that **already exist** in this repo unless evidence shows otherwise:

| Layer | Paths |
|--------|--------|
| Constitutional | `/AGENTS.md` |
| Claude workflow | `/CLAUDE.md` |
| Local domain | `/src/AGENTS.md`, `/backend/websearch_service/AGENTS.md`, `/sql/AGENTS.md`, `/deployment/AGENTS.md` |
| Task playbooks | `/skills/*/SKILL.md`, router `/skills/INDEX.md` |

**Architecture (evidence-based):** Frontend lives in `src/` (not `frontend/`). Backend is `backend/websearch_service/`. **Schema migrations in production:** Alembic under `backend/websearch_service/alembic/`. **`sql/`** is reference and manual verification only (`sql/README.md`, `sql/AGENTS.md`). There is **no** committed `supabase/` CLI project root in this repo unless one appears in the tree during your run.

**Non-negotiables (must not contradict in any file you write):** No model/provider/service-role secrets in `VITE_*`; JWT user identity from verified claims on privileged backend paths (`app/services/auth.py`); do not weaken `AUTH_REQUIRED`, RLS, or CI security gates to pass builds; OpenAPI + `src/lib/generated/api-types.ts` must stay in sync when HTTP contracts change (see root `AGENTS.md`).

If **this skill** conflicts with **`AGENTS.md`**, **repository rules win** — stop and fix the skill or escalate.

## Allowed files and paths

- **Read:** Across the repo as needed for evidence (workflows, `package.json`, `README.md`, existing `AGENTS.md`, `skills/`).
- **Write:** Only governance markdown: root `AGENTS.md`, `CLAUDE.md`, `skills/**`, and local `AGENTS.md` under `src/`, `backend/websearch_service/`, `sql/`, `deployment/` when the task explicitly includes updates there.

Do **not** change application source, tests, OpenAPI export output, or CI workflow files **unless** the human task explicitly requires it (that scope belongs outside this skill).

## Required reading (before edits)

- Root [`AGENTS.md`](../../AGENTS.md) — full constitution; your output must stay consistent.
- [`CLAUDE.md`](../../CLAUDE.md) — Claude workflow and skills reference.
- [`skills/INDEX.md`](../INDEX.md) — task routing; any new skill must be indexed or intentionally excluded with justification.
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — **authoritative** CI commands for parity checks.
- Root [`package.json`](../../package.json) — **authoritative** npm script names; do not invent scripts.

## Workflow (ordered)

### PHASE 0 — Instruction discovery

1. Find and read all active instruction and governance docs: `AGENTS.md`, `CLAUDE.md`, every `**/AGENTS.md`, `skills/**/SKILL.md`, `skills/INDEX.md`, and any contributor or security docs the user cited.
2. Build an **active hierarchy** list: what is constitutional vs local vs procedural.
3. **Preserve** all valid repo-specific constraints; note redundancies or conflicts for PHASE 2.

### PHASE 1 — Repo forensics

Map from **evidence only**: frontend (`src/`), backend (`backend/websearch_service/`), Alembic, `sql/`, deployment touchpoints (`deployment/`), AI proxy (`app/routes/ai_proxy.py`), CI (`.github/workflows/`), generated API (`docs/openapi.json`, `src/lib/generated/`).

Identify **dependency direction**, **invariants** (JWT, RLS, OpenAPI drift gate, Alembic authority), **high-risk zones** (auth, migrations, AI proxy), and **boundaries** agents must not cross without a dedicated skill.

### PHASE 2 — Gap analysis

Compare the current instruction stack to the goals: layering, forbidden zones, explicit verification, stop conditions, minimal root bloat, procedures in skills.

Record: missing rules, weak or generic wording, misplaced detail (root vs skill vs local), overreach risks, auth/RLS/migration underspecification, **recurring tasks** that deserve a skill.

### PHASE 3 — Stack design

Produce a **coherent file plan**: which files exist, which to add/remove, why each layer exists. Do **not** create `frontend/AGENTS.md` if the frontend remains in `src/`. Do **not** add `supabase/AGENTS.md` unless a `supabase/` project appears in repo.

Root `AGENTS.md` stays **constitutional**; deep procedures belong in `skills/`; directory-specific law in local `AGENTS.md`.

### PHASE 4 — Write or patch files

When implementing, produce **minimal, enforceable** diffs. Each rule should **constrain behavior**, **protect architecture**, **improve verification**, or **reduce overreach**.

After substantive edits to governance only (no app code): verification commands in root `AGENTS.md` **do not** need to be run for markdown-only paths unless you also changed executable code or CI.

When **delivering new or replaced file bodies** in chat, use this exact format per file:

```text
FILE: <path>
<full file content>
```

Separate files clearly. Do not wrap truth-only summaries in `FILE:` blocks unless you are writing that path’s content.

### PHASE 5 — Self-critique

Before finishing, check your result for: ambiguity; duplicated constitution inside skills; missing guardrails; verification commands that don’t exist in `package.json` or CI; weak stop conditions; instructions that encourage broad refactors or security weakening; generic filler; misplaced long procedures in root `AGENTS.md`.

**Tighten** before final output.

## Commands (run when verifying parity with CI or `package.json`)

Use these **only** when the task includes proving script/workflow alignment (e.g. after documenting a new check):

```bash
# Frontend gates (root package.json); CI frontend job also runs test:coverage — see ci.yml
npm run lint:ci
npm run type-check
npm run test
npm run build
```

```bash
# CI parity for optional deeper check
npm run test:coverage
```

```bash
# OpenAPI drift (when documenting contract workflow)
python backend/websearch_service/export_openapi.py
npm run generate:api-types
git diff --exit-code docs/openapi.json src/lib/generated/ || exit 1
```

```bash
# Backend (when documenting backend verification)
cd backend/websearch_service
pytest tests/ -v --cov=app --cov-branch --cov-fail-under=80
```

Do **not** claim you ran commands unless you did or note they were not applicable.

## Forbidden actions

- **Weakening** production auth, JWT verification, RLS, or CI security checks in any instruction file.
- **Inventing** directories, env vars, npm scripts, or workflows not present in the repo.
- **Instructing** raw `sql/*.sql` as the default production migration path (Alembic is authoritative).
- **Collapsing** all guidance into one file or **duplicating** the full constitution inside every skill.
- **Treating** ChatGPT/generic templates as substitute for repo evidence.

## Done when

- Hierarchy is consistent: root vs `CLAUDE.md` vs local `AGENTS.md` vs `skills/`.
- No contradictions with `AGENTS.md` or observed CI/`package.json` facts.
- New or changed skills appear in `skills/INDEX.md` when they are user-facing task routes.
- Self-critique in PHASE 5 addressed ambiguities and overreach.

## Required evidence in the final response

1. **What changed** — paths, one sentence each.
2. **Why** — tie to governance goal or audit finding.
3. **Verification** — commands run (if any) or explicit “not applicable / markdown-only”.
4. **Risks / follow-ups** — e.g. human must commit untracked governance files, or add `supabase/AGENTS.md` only if repo gains that tree.
