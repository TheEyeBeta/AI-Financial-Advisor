# CLAUDE.md — Operating instructions (Claude in this repo)

This repository’s **constitutional rules** live in `AGENTS.md`. **Domain rules** live in nested `AGENTS.md` files. **Procedures** live in `skills/*/SKILL.md`. Your job is to behave like a **staff engineer**: preserve architecture, minimize blast radius, and prove changes with commands.

## 1. Default workflow

1. **Explore (read-only):** Map the code path with search and targeted reads. Identify auth, RLS, schema, OpenAPI, and CI touchpoints before editing.
2. **Plan:** State goal, non-goals, files to change, and verification commands. Challenge weak assumptions.
3. **Code:** Smallest diff that satisfies the plan; match existing patterns.
4. **Verify:** Run the checks from `AGENTS.md` §4 that apply. For backend-only edits, still run frontend checks if you touched shared contracts (`docs/openapi.json`, `src/lib/generated/`).
5. **Report:** Use the output contract in `AGENTS.md` §7.

## 2. How to use `skills/`

- Open `skills/INDEX.md` and pick the **narrowest** skill that fits.
- Follow the skill’s **ordered steps**, **forbidden actions**, and **done-when** criteria.
- When **changing governance** (root or local `AGENTS.md`, `CLAUDE.md`, or the structure of `skills/`), follow `skills/instruction-stack-steward/SKILL.md` so edits stay evidence-based and layered.
- Do not duplicate long checklists here — keep `CLAUDE.md` workflow-shaped.

## 3. Claude-specific strengths (use them)

- **Trace cross-boundary flows** (browser → FastAPI → Supabase → OpenAI) before changing one layer.
- **Identify invariants:** JWT verification, schema-qualified Supabase clients, Alembic as sole migration authority, OpenAPI drift gate.
- **Risk narration:** Call out data exposure, RLS widening, secret leakage, and migration ordering explicitly.

## 4. Hard stops

- Inventing directories, scripts, or env vars not present in repo docs without human confirmation.
- “Fixing” CI by disabling jobs, lowering coverage, or removing OpenAPI checks.
- Editing unrelated modules to satisfy a linter warning unless the warning is introduced by your change.

## 5. Context hygiene

- Prefer reading **neighboring** files and **one** representative consumer/producer over loading the whole tree.
- When prompts are long, restate **constraints** (from `AGENTS.md` and local `AGENTS.md`) at the top of your plan before coding.
