# Runbook: Cost spike

**Rehearsed:** NO

- **Trigger:** `/api/admin/ai-budget/status` circuit-breaker state reaches
  `warning`/`restricted`/`hard_stop`, provider billing alert (OpenAI budget
  threshold — soft/advisory only, see below), `quota_exceeded_402` audit
  events, Railway/Vercel/Supabase usage alarms.
- **Severity:** SEV-2 (spend threatens service continuity or the local hard
  stop has engaged) / SEV-3 (anomalous but bounded, `warning`/`restricted`).
- **User impact:** none in `normal`/`warning`. In `restricted`, non-essential
  AI requests get an explicit 503 (`reason_code: restricted`) with retry
  guidance. In `hard_stop`, all non-exempt AI requests get an explicit 503
  (`reason_code: hard_stop`) until spend resets or an admin override is set.

## Immediate containment
1. Check the global picture first: `GET /api/admin/ai-budget/status`
   (service-role or admin JWT) — circuit-breaker state, today's/this month's
   spend vs `AI_BUDGET_DAILY_USD`/`AI_BUDGET_MONTHLY_USD`, request/token
   counters, active concurrency. This is read-only and never returns prompt
   content or per-user identifiers.
2. Identify the spender: compare the global picture above against per-user
   token counters (rate limiter) and OpenAI's usage dashboard by day/model —
   one user near per-user caps across accounts vs broad organic growth vs a
   runaway internal loop.
3. Runaway internal loop (scheduler/job hammering a provider): stop the
   offending job (`scheduler-failure.md` lever) — this is the classic
   self-inflicted spike. The global concurrency/rate limits in the budget
   guard bound the blast radius even before you find and stop it.
4. Abusive account(s): suspend per `abuse-rate-limit.md`.
5. **Do not raise `AI_BUDGET_DAILY_USD`/`AI_BUDGET_MONTHLY_USD` reflexively**
   — that's an owner decision with the evidence in front of them. If service
   continuity is more urgent than the spend risk, use the audited manual
   override (`POST /api/admin/ai-budget/override`, time-bounded, disabled by
   default) instead of widening the budget itself.
6. **Do not raise the provider-side (OpenAI) budget cap reflexively either**
   — and note it would not help mid-incident anyway: OpenAI budget alerts
   are soft/advisory and are *not* what stops traffic (`AI_CONTROLS.md` §1).
   The local hard stop is the actual circuit breaker.

## Diagnostics
- `GET /api/admin/ai-budget/status` (primary — this incident's source of truth).
- Provider usage dashboards (OpenAI, Perplexity), Railway metrics, Supabase usage page.
- Audit events: `ai_budget_manual_override_set/cleared`, `ai_cost_reconciliation_completed/failed`, fallback reasons, per-request correlation IDs.
- Current controls and their limits: `docs/ai/AI_CONTROLS.md` §1 (global + per-user caps; G-1 closed).

## Dashboards / logs
`/api/admin/ai-budget/status` for real-time state. `POST
/api/admin/ai-budget/reconcile-costs` triggers an on-demand drift check
against OpenAI's actual billed cost (requires `OPENAI_ADMIN_API_KEY`) —
useful to confirm the internal cost model isn't drifting from what's
actually being billed; a failure here is non-fatal and does not affect the
hard stop. Provider billing alert config is EXTERNAL (verify thresholds
exist as a secondary signal, not the primary control).

## Recovery
- Abuse: suspension + (if pattern generalizes) tighten per-endpoint limits via config PR.
- Organic growth: document per-active-user cost (beta telemetry template), decide budget change deliberately via `AI_BUDGET_DAILY_USD`/`AI_BUDGET_MONTHLY_USD`.
- Self-inflicted: fix the loop, add a regression test, then re-enable.
- Stuck in `hard_stop` and service continuity is judged more urgent than
  spend risk: set a short, audited manual override
  (`POST /api/admin/ai-budget/override`, e.g. 30–60 min) while the root
  cause is fixed; clear it (`DELETE /api/admin/ai-budget/override`) as soon
  as it's no longer needed — it does not clear itself early and is disabled
  by default.

## Rollback
If a deploy changed model/prompt economics (e.g., switched to a pricier model), roll it back — model changes require eval + cost evidence per `AI_CONTROLS.md` §4. Check whether `AI_MODEL_PRICING_JSON`/the pricing table in `ai_pricing.py` needs a matching update so cost accounting stays accurate.

## Validation
Circuit-breaker state back to `normal` (or `warning`, if that's the accepted
steady state) via `/api/admin/ai-budget/status`, daily spend back within the
projected band for 48 h, and no *sustained or unexplained*
`quota_exceeded`/fallback events (isolated provider-side quota events with
fallback working are not an incident by themselves).

## Communication
Internal unless users hit degraded AI states (`restricted`/`hard_stop`); then a brief status note.

## Post-incident
Feed actuals into cost-per-active-user in the cohort report. If the
existing `AI_BUDGET_*` thresholds triggered too early/late or the manual
override was needed, revisit the beta defaults in `.env.example` — they are
configuration, not fixed policy.
