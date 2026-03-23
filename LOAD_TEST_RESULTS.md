# Load Test Results

This file is the reporting surface for the k6 load tests in [`tests/load/`](./tests/load).

Current status: not yet benchmarked in this workspace. The workflow is in place, but the first real run should populate the metrics below from staging.

## What Is Measured

- `chat`: 50 concurrent users hitting `/api/chat`.
- `search`: 200 concurrent users hitting `/api/search`.
- `paper trading`: 100 concurrent users writing BUY/SELL journal entries in Supabase.

Important constraint: paper trading is not backed by a dedicated backend endpoint in the current repo. The UI writes directly to Supabase, so the load test targets the real `trading.trade_journal` write path instead of inventing an API that does not exist.

## Thresholds

- `p95 latency < 500ms`
- `error rate < 1%`

For `/api/chat` and `/api/search`, `429` responses are treated as expected rate-limit behavior, not as transport failures. The failure threshold only counts `5xx` and request errors.

## How To Refresh

1. Run the manual workflow in `.github/workflows/load-tests.yml`.
2. Download the `k6-load-results` artifact.
3. Copy the relevant numbers from the k6 summary JSON into the tables below.
4. Replace the placeholder charts with the latest numbers.
5. Do not hand-edit the metrics to make the run look better. If the run regresses, keep the regression visible.

## Latest Summary

| Scenario | p95 latency | Error rate | Notes |
|---|---:|---:|---|
| Chat | Pending | Pending | Includes auth + OpenAI-backed request path. |
| Search | Pending | Pending | Measures backend request handling and rate limiting. |
| Paper trading | Pending | Pending | Measures direct Supabase journal writes. |

## Placeholder Charts

```mermaid
xychart-beta
  title "Load Test p95 Latency"
  x-axis ["chat", "search", "paper trading"]
  y-axis "ms" 0 --> 1000
  line [0, 0, 0]
```

```mermaid
xychart-beta
  title "Load Test Error Rate"
  x-axis ["chat", "search", "paper trading"]
  y-axis "rate" 0 --> 1
  line [0, 0, 0]
```

## Notes

- `/api/chat` includes provider latency, so the 500ms threshold is strict and may fail when the upstream model is slow.
- The paper-trade test writes synthetic BUY/SELL rows to `trading.trade_journal` and cleans them up after each iteration.
- If you want pure backend numbers for chat/search, capture those separately from provider-dependent latency and document the split explicitly.
