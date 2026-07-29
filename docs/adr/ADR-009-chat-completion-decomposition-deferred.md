# ADR-009: Decompose `chat_completion` (AI Proxy God Function) — Deferred, Flagged for Human Scheduling
## Status
Proposed (not implemented — see Decision)

## Context
`POST /api/chat` (`app/routes/ai_proxy.py:2331-3268`, the `chat_completion` handler) is roughly 940 lines and inlines rate limiting, AI-budget reservation/reconciliation, prompt-injection detection, non-finance gating, tier classification, Meridian/market context assembly, tool-call orchestration (fan-out, timeout budget, follow-up stream), dual streaming/non-streaming response paths, and audit logging, with deeply nested closures (`generate_stream`, `_consume_stream`, `_run_single_tool`). This is this codebase's single hottest path — the AI chat pipeline — and its revenue/cost surface (AI budget guard, provider fallback) is directly load-bearing.

Team/ops context: this is a solo/small-team codebase without a dedicated on-call rotation or a staged canary deploy path for the AI proxy specifically; `ai_proxy.py` has test coverage but no seam that lets any one of these concerns (e.g. tool-call orchestration) be unit-tested independently of the others today.

## Problem
Should `chat_completion` be decomposed into named, independently testable units (e.g. a request-validation layer, a budget/rate-limit guard, a context-assembly service, a tool-orchestration service, and a response-streaming layer), and if so, done now as part of this audit pass or scheduled separately?

## Decision
**Defer the actual refactor; this ADR records the target shape and the reason it is not executed in this pass.** Recommended target decomposition (hexagonal-flavored — see `references/patterns.md`, "heavy need for isolated testability" is exactly this case):
- `ChatRequestGuard` — rate limit + AI-budget reservation/release, extracted from the current inline calls.
- `PromptSafetyClassifier` — prompt-injection detection + non-finance/tier gating, already semi-isolated in helper functions; promote to a real seam.
- `ChatContextAssembler` — Meridian/market context gathering, currently interleaved with request handling.
- `ToolOrchestrator` — the fan-out/timeout-budget/follow-up-stream logic in `_run_single_tool`/`_consume_stream`, the most complex and most valuable piece to isolate for testing.
- `ChatResponseStreamer` — the dual streaming/non-streaming response construction, including the provider-fallback branching duplicated three times today (`_call_openai`, `_call_openai_responses`, `_start_chat_completion_stream`) — decomposing this also naturally fixes that duplication.
- The route handler itself becomes a thin composition of the above, mirroring the pattern already used correctly elsewhere in this codebase (e.g. `admin_jobs.claim_next_job` as a seam over a queue, rather than inlining queue logic in the route).

**Why not now:** this is the AI proxy's single busiest code path, has no staged/canary deploy step, and a decomposition of this size (940 lines, 5+ concerns, deeply nested async generators) cannot be safely verified by running `pytest` alone — it needs live traffic shadowing or a staging soak that this repo's current CI/CD topology does not provide (see the CI/CD findings in the same audit: `promote-to-prod.yml` had no gate on `release-verification.yml`, itself only fixed in this same pass). Per this repo's own escalation rule (`AGENTS.md` §6: "CI failures you cannot reproduce locally," and the audit brief's own instruction to flag rather than guess at anything requiring a human product/security decision on acceptable risk), refactoring the revenue-critical hot path without a human explicitly signing off on the acceptable regression-testing bar is exactly that kind of decision.

## Alternatives considered
- **Refactor now, rely on existing pytest coverage.** Rejected: existing tests exercise `chat_completion` at the route/integration level; a structural decomposition this large risks silently changing behavior (e.g. budget-release ordering, stream cleanup timing) in ways unit tests over the new seams wouldn't catch if the seams themselves are drawn incorrectly on the first attempt.
- **Do nothing / leave as-is indefinitely.** Rejected: the coupling cost is real and already visible (the tripled provider-fallback logic, finding-level duplication risk) — this should be scheduled, not shelved permanently.
- **Partial refactor: extract only the tripled fallback logic into a shared helper, leave the rest.** This is a reasonable smaller first step and is recommended as the actual next action (low risk, directly removes a real duplication finding) — but is still a behavior-adjacent change to the hot path's error handling and was left to a follow-up commit rather than bundled into this audit pass, to keep this pass's diff reviewable and its verification evidence honest (see AGENTS.md §7: don't claim tests passed without having run them against the actual change).

## Consequences
- Positive: recording the target shape now means the next person to touch `ai_proxy.py` under time pressure has a decomposition to extract toward incrementally, rather than continuing to add a sixth concern to the existing function.
- Negative: the God-function coupling and blast-radius risk (a bug in tool orchestration can still take down budget accounting in the same stack frame) remains until this is actually scheduled and executed.
- Risk / revisit trigger: the next incident or on-call escalation that traces back to an interaction between two of the concerns listed above (e.g. a budget-release bug triggered by a tool-orchestration timeout) is the signal to execute this decomposition rather than patch it in place again.
