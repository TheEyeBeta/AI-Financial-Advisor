# IRIS Latency Audit — 2026-04-12

> Production audit of the IRIS chat pipeline latency.
> Target: INSTANT < 1,000ms TTFT, BALANCED < 3,000ms TTFT.
> Current: INSTANT ~3,000ms, BALANCED ~5,000ms.

## Key Findings Summary

1. **34,832-char system prompt sent on ALL tiers including INSTANT** — this is the #1 latency driver
2. **Sequential pipeline steps** that could be parallel add 700-1,900ms to BALANCED
3. **Two redundant LLM calls** (`_classify_query` + `classify_intent`) before streaming begins
4. **JIT cache refresh** on Meridian miss runs 13+ sequential DB queries in the hot path
5. **GPT-5 reasoning model** used for trivial greetings where `gpt-4o-mini` would suffice

## Remediation Priority

| Fix | TTFT Reduction | Effort | Tiers |
|---|---|---|---|
| Tiered system prompt | 2,000-2,500ms | Low | INSTANT, FAST |
| Parallelize pipeline | 700-1,900ms | Low | BALANCED |
| Regex intent routing | 300-2,000ms | Medium | FAST, BALANCED |
| Faster model for INSTANT | 500-1,500ms | Low | INSTANT |
| Skip _classify_query for FAST | 500-2,000ms | Low | FAST |

## Full audit

See the session transcript for the complete 9-section audit with file:line references,
execution traces, and implementation prompts.
