# Runbook: Market-data provider unavailable

**Rehearsed:** NO

- **Trigger:** trade-engine endpoints returning 502/503 availability metadata; DataAPI client errors in logs; rankings/prices stale in UI.
- **Severity:** SEV-3 (snapshot fallback + explicit availability metadata by design, ADR-007).
- **User impact:** prices/rankings served from snapshots with staleness indicated; paper trades still execute against snapshot prices; no fabricated values (tested: `test_trade_engine.py`).

## Immediate containment
None usually needed — the degradation is designed and user-visible. Confirm the UI is actually showing the unavailable/stale states rather than erroring blank.

## Diagnostics
```bash
curl -s https://<backend>/api/trade-engine/<representative-endpoint> | jq '.availability // .detail'
```
Railway logs for `dataapi_client` errors (`test_dataapi_client.py` documents the error taxonomy); DataAPI substrate status (external).

## Dashboards / logs
Railway backend logs; Sentry; scheduler logs (ranking refresh 01:00 UTC depends on data availability).

## Recovery
- Substrate recovers → next scheduled refresh repopulates; no redeploy.
- Credential issue → rotate DataAPI credentials (`KEY_ROTATION.md` §3 pattern).
- If snapshots grow older than a trading day, consider pausing the ranking refresh announcement rather than serving misleading ranks — flag to owner.

## Rollback
Not applicable.

## Validation
Endpoints return live availability again; ranking job next run succeeds (`scheduler-failure.md` diagnostics); UI staleness banners clear.

## Communication
In-app staleness indicators carry it; status note only if multi-day.

## Post-incident
Log the outage window; verify no paper trades executed against absurd stale prices (spot-check `trading.trade_journal` entries in the window).
