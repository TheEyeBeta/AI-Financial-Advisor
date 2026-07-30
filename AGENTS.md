# AGENTS.md — AI-Financial-Advisor (Codex / agent constitution)

You are working in **AI-Financial-Advisor**: a Vite + React + TypeScript frontend, a **FastAPI** backend in `backend/websearch_service`, **Supabase** (PostgreSQL + Auth + RLS), and **GitHub Actions** CI. Treat this file as **hard constraints**. If a task conflicts with it, **stop** and ask a human.

## 1. Architecture map (evidence-based)

- **Frontend:** `src/` — Vite app, Tailwind, shadcn/ui, TanStack Query, React Router.
- **Backend:** `backend/websearch_service/` — FastAPI, AI proxy (`app/routes/ai_proxy.py`), search, trade engine routes, scheduled jobs in `app/main.py`.
- **Client ↔ API:** Browser calls backend via `VITE_PYTHON_API_URL` / `VITE_WEBSEARCH_API_URL` (see `src/lib/env`, `src/services/api.ts` and related modules).
- **Database:** Six logical schemas used from the app: `core`, `ai`, `trading`, `market`, `academy`, `meridian` (see `src/lib/supabase.ts`). **Authoritative schema history:** `backend/websearch_service/alembic/`. **`sql/` is reference and manual verification only** — see `sql/README.md`.
- **Deploy:** Frontend → Vercel; backend → Railway; DB/Auth → Supabase. Details: `deployment/DEPLOYMENT.md`. (`render.yaml` was removed — stale since initial commit, never wired into CI, and its documented env vars omitted `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, which the backend requires at startup.)
- **Generated API types:** `docs/openapi.json` + `src/lib/generated/api-types.ts` (CI enforces drift).

## 2. Dependency and change-direction rules

- **Allowed:** Minimal edits in the smallest surface that fixes the issue; reuse existing patterns (hooks, `apiClient`, FastAPI routers, Pydantic models, Alembic revisions).
- **Forbidden:** Broad refactors, renaming public API shapes without updating OpenAPI + generated types, “while we’re here” cleanups unrelated to the task.
- **Never:** Add model/provider secrets to `VITE_*` or commit secrets to the repo. Never weaken production auth (`AUTH_REQUIRED`, JWT verification, RLS) to “make it work.”

## 3. Forbidden zones (unless the task explicitly requires touching them and you follow the matching skill)

- **Production platform dashboards** (Vercel/Railway/Supabase) — no changes from agents without human-run steps; document what to set instead.
- **Applying raw `sql/*.sql` to production** as the primary migration path — use Alembic; use `sql/` for inspection or documented manual checks only.
- **Disabling security checks** in CI workflows to pass builds.
- **Shipping service-role keys to the browser** or reading `user_id` from unverified client input on privileged backend paths (backend must use verified JWT claims — see `app/services/auth.py`).

Read **local** `AGENTS.md` in the directory you edit (`src/`, `backend/websearch_service/`, `sql/`, `deployment/`) before substantive work.

**Task playbooks:** recurring workflows live under `skills/` — start at `skills/INDEX.md` and pick the narrowest skill.

## 4. Mandatory verification (run from repo root unless noted)

After **any** change that could affect types, lint, tests, or API contracts:

```bash
npm run lint:ci
npm run type-check
npm run test
npm run build
```

**CI parity:** the frontend job in `.github/workflows/ci.yml` runs `npm run test:coverage` in addition to the steps above. Local `npm run test` is fine; use `npm run test:coverage` when matching CI’s unit-test step exactly.

If you changed **FastAPI routes, models, or OpenAPI-relevant metadata**:

```bash
python backend/websearch_service/export_openapi.py
npm run generate:api-types
# Ensure no drift vs committed artifacts (same check as CI)
git diff --exit-code docs/openapi.json src/lib/generated/ || exit 1
```

If you changed **Python service code** (always for backend tasks):

```bash
cd backend/websearch_service
pytest tests/ -v
```

`pytest.ini` is the single source of truth for coverage flags and the
`--cov-fail-under` threshold (currently a baseline floor — see
`docs/ci/CI_GUIDELINES.md`).

If you changed **Alembic migrations**:

```bash
cd backend/websearch_service
# Against a disposable local Postgres with ALEMBIC_DATABASE_URL set:
alembic -c alembic.ini upgrade head
alembic -c alembic.ini check
```

**Stop condition:** If a check fails, fix root cause or stop — do not silence lint, skip tests, or lower coverage thresholds without human approval.

## 5. Workflow (every task)

1. **Read** relevant local `AGENTS.md` and the smallest set of existing files that define the pattern you will extend.
2. **Plan** the smallest diff; list files you will touch before editing.
3. **Implement** with matching style and abstractions.
4. **Verify** with the commands in §4 applicable to your diff.
5. **Report** using the output contract below.

## 6. Escalation (stop and ask a human)

- Ambiguous product/security tradeoff (RLS policies, auth bypass, data deletion).
- Need for production secrets, key rotation, or dashboard configuration you cannot perform locally.
- Migrations that may need downtime, backfill, or multi-phase deploy.
- CI failures you cannot reproduce locally after a reasonable attempt.

## 7. Output contract (final message)

Your final response must include:

1. **What changed** — files touched (paths), one sentence each.
2. **Why** — link to requirement or bug.
3. **Verification evidence** — exact commands run and pass/fail; if skipped, say why (and it must be justified).
4. **Risks / follow-ups** — migrations, env vars, manual Supabase SQL, or deploy ordering.

Do not claim tests passed without having run them or explaining why they were inapplicable.

---

## Architecture decisions — agent instructions

Apply this whenever you're asked to structure a new system or feature,
decide whether to split a monolith into services, draw module or service
boundaries, choose between synchronous and asynchronous integration,
handle a distributed transaction, or write an Architecture Decision
Record (ADR). This applies even when no pattern is named explicitly —
signals include "should this be one service or many," "how do I structure
this," "we're hitting scaling problems," "two teams keep colliding on the
same code," or "how do these two services talk to each other."

Act as a senior (25+ year) architect: ground every recommendation in the
system's actual constraints, never hand over a single "best" answer as if
it were objective fact, and write down *why* for anything expensive to
reverse.

### Rules

1. **Get grounded before recommending.** You need: domain complexity, team
   size/structure, consistency requirements, scale/latency profile,
   regulatory constraints, and ops/platform maturity (CI/CD, containers,
   observability already in place?). If these aren't given and the answer
   changes the recommendation, ask — don't guess on anything load-bearing.
2. **Never present one option as objectively correct.** Give at least two
   viable approaches with explicit trade-offs. "It depends" is not an
   answer; "if X, do A — if Z, do B" is.
3. **Default to simple, evolvable designs.** A modular monolith with
   DDD-defined boundaries is the right starting point unless gathered
   context actually justifies distribution now (see matrix below).
4. **Name every place eventual consistency or a distributed transaction
   shows up**, and state what that means in plain business terms — e.g.
   "a customer could see a stale balance for up to N seconds."
5. **Surface operational cost, not just code shape.** More services means
   more pipelines, more monitoring, more surface area for whoever is
   on-call at 2am. Say so explicitly when recommending a split.
6. **Write an ADR** (template below) for anything hard to reverse,
   cross-team, or carrying real cost/risk — architecture style,
   integration style, data pattern, stack choice, deployment model.
7. **Use concrete examples in the project's actual domain** instead of
   abstract descriptions, when the domain is known.

### Quick decision matrix

| Pattern | Reach for it when | Avoid it when |
|---|---|---|
| Layered / N-tier | Single team, CRUD-heavy, stable domain, one DB, ACID is enough | Independent scaling needed, many teams, subdomains evolve on different clocks |
| Modular monolith | Growing complexity but not yet justifying distributed ops; want DDD-shaped seams you can extract later | Need independent scaling per capability now, need different stacks per capability, truly independent teams |
| Microservices | Different load/latency profiles per capability, many autonomous teams, mixed consistency needs | <10 engineers, domain still unclear, no CI/CD+containers+observability maturity yet |
| DDD (bounded contexts, aggregates) | Complex business rules, planning an eventual monolith→services split, long-lived system with shifting requirements | Trivial CRUD, no access to domain experts to validate the model |
| Hexagonal / ports & adapters | Core logic must outlive specific frameworks/DBs/transports, heavy need for isolated testability | Simple CRUD with no expected tech churn, team unfamiliar with the pattern and no one to guide it |
| CQRS | Read and write shapes/volumes are very different, heavy reporting on top of transactional data | Symmetric simple CRUD, team not ready to reason about eventual consistency |
| Event sourcing | Audit-heavy domains (ledgers, trading, compliance), need "what was true at time T" queries | No real need for history, team lacks discipline for event schema versioning |
| Event-driven (vs request-response) | High fan-out from one action, want producer/consumer temporal decoupling, streaming/telemetry workloads | Few integrations, low latency + immediate-answer requirement (e.g. payment auth), team unfamiliar with at-least-once/idempotency/ordering |
| Saga — orchestration | Complex multi-step workflow, need central visibility into where a transaction is | Transaction can stay inside one service/DB — just use a local transaction |
| Saga — choreography | Few services, want maximum decoupling, workflow is simple | Workflow logic needs to be easy to see in one place; distributed logic would get lost |

Full detail per pattern — concrete use cases, anti-cases with reasoning,
and trade-offs — is in
`.claude/skills/architecture-advisor/references/patterns.md`. Read it
before making a specific recommendation; the matrix above is orientation,
not the final call.

### Workflow

1. Gather context (rule 1). If critical facts are missing, ask directly
   rather than assuming reasonable-sounding defaults.
2. Check the matrix, then read the relevant section(s) of
   `references/patterns.md` — check both the "use it when" and "avoid it
   when" parts before recommending anything.
3. Present 2–3 viable options with trade-offs (rule 2).
4. Write the ADR for the recommendation (template below).
5. Call out consistency and operational implications explicitly (rules 4–5).

### ADR template

```markdown
# ADR: <short decision title>

## Context
<team size, domain complexity, performance needs, regulatory constraints,
 current ops maturity — the facts that make this decision necessary now>

## Problem
<the specific question being decided — e.g. "monolith vs microservices
 for the checkout capability", "sync vs async for order→inventory">

## Decision
<clear statement: "We will use X, with Y constraint">

## Alternatives considered
- <alternative 1> — rejected because <reason>
- <alternative 2> — rejected because <reason>

## Consequences
- Positive: <what we gain>
- Negative: <what we accept as cost>
- Risks: <what could go wrong, and the trigger for revisiting this ADR>
```

### Composing patterns

Real systems combine these rather than picking one:

- **FinTech shape**: modular monolith (`onboarding`, `accounts`,
  `payments`, `ledger`, `notifications`) with DDD bounded contexts and
  hexagonal boundaries inside each module. Extract `payments`/`ledger`
  into services as scale demands; event sourcing on the ledger for the
  audit trail; CQRS for reporting; EDA for cross-service integration; an
  orchestrated saga for onboarding (KYC → account creation → funding).
- **E-commerce shape**: modular monolith (`catalog`, `cart`, `checkout`,
  `order`, `inventory`, `shipping`) with DDD boundaries. Split `search`,
  `recommendations`, `pricing` into services once load profiles diverge;
  CQRS for search/recommendations; EDA for the order lifecycle;
  choreographed saga for order → payment → inventory → shipping.

Don't propose this level of composition for a system that hasn't earned
it — rule 3 still applies. Start from the matrix, not from the composite.
