# Service Down Scenario Runbook

This project now includes resilience controls for external dependencies.

## Implemented behaviors

- Websearch service exposes:
  - `/health` for basic service metadata.
  - `/health/live` for liveness.
  - `/health/ready` for readiness based on external search provider connectivity.
- Frontend periodically checks service health for:
  - `ai_backend` (`VITE_PYTHON_API_URL` + `/health`).
  - `websearch` (`VITE_WEBSEARCH_API_URL` + `/health`).
- Frontend wraps advisor UI with graceful degradation:
  - Loading state while connectivity is unknown.
  - Degraded warning if latency is high.
  - Down fallback with retry button if service is unavailable.
- Fetch calls can use `resilientFetch` for timeout + retry with exponential backoff.

## Service down validation

1. Start frontend and backends.
2. Stop the AI backend or websearch service.
3. Open `/advisor`.
4. Confirm fallback card appears and retry button increments retry count.
5. Restart service and click retry.
6. Confirm UI returns to normal service state.

## Automated validation

Run:

```bash
node scripts/validate-services.mjs
```

This checks:

- `/health` and `/health/ready` status behaviors.
- AI backend health reachability.
- Timeout/retry error path.
