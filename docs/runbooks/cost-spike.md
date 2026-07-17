# Runbook: Cost spike

**Rehearsed:** NO

- **Trigger:** provider billing alert (OpenAI budget threshold), `quota_exceeded_402` audit events, Railway/Vercel/Supabase usage alarms.
- **Severity:** SEV-2 (spend threatens service continuity or budget cap hit) / SEV-3 (anomalous but bounded).
- **User impact:** none until a cap is hit; then AI features degrade to explicit failure states.

## Immediate containment
1. Identify the spender: OpenAI usage dashboard by day/model; compare with per-user token counters (rate limiter) — one user near daily caps across accounts vs broad organic growth vs a runaway internal loop.
2. Runaway internal loop (scheduler/job hammering a provider): stop the offending job (`scheduler-failure.md` lever) — this is the classic self-inflicted spike.
3. Abusive account(s): suspend per `abuse-rate-limit.md`.
4. **Do not raise the provider budget cap reflexively** — that's an owner decision with the evidence in front of them.

## Diagnostics
- Provider usage dashboards (OpenAI, Perplexity), Railway metrics, Supabase usage page.
- Audit events: fallback reasons, per-request correlation IDs.
- Current controls and their limits: `docs/ai/AI_CONTROLS.md` (per-user caps exist; **no global cap — G-1**; this runbook is the compensating manual control).

## Dashboards / logs
As above; billing alert config is EXTERNAL (verify thresholds actually exist — `AI_CONTROLS.md` G-1c).

## Recovery
- Abuse: suspension + (if pattern generalizes) tighten per-endpoint limits via config PR.
- Organic growth: document per-active-user cost (beta telemetry template), decide budget change deliberately.
- Self-inflicted: fix the loop, add a regression test, then re-enable.

## Rollback
If a deploy changed model/prompt economics (e.g., switched to a pricier model), roll it back — model changes require eval + cost evidence per `AI_CONTROLS.md` §4.

## Validation
Daily spend back to projected band for 48 h; no `quota_exceeded` events.

## Communication
Internal unless users hit degraded AI states; then a brief status note.

## Post-incident
Feed actuals into cost-per-active-user in the cohort report; re-prioritize gap G-1 (global budget enforcement) if this recurs.
