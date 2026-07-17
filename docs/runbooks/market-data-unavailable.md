# Runbook: Market-data provider unavailable

**Rehearsed:** NO

- **Trigger:** trade-engine endpoints returning 502/503 availability metadata; DataAPI client errors in logs; rankings/prices stale in UI.
- **Severity:** SEV-3 (snapshot fallback + explicit availability metadata by design, ADR-007) — escalate to SEV-2 once snapshots exceed one trading day (see below).
- **User impact:** prices/rankings served from snapshots with staleness indicated; paper trades still execute against snapshot prices; no fabricated values (tested: `test_trade_engine.py`).
- **Known gap (be honest during the incident):** there is **no code-level maximum-snapshot-age gate on trade execution** today — trades keep executing against snapshots of any age. The age threshold below is an *operational* control until that gate exists (tracked as a candidate hardening item in the journey matrix's `trading-market-data-unavailable` notes).

## Immediate containment
Usually none needed — the degradation is designed and user-visible. Confirm the UI is actually showing the unavailable/stale states rather than erroring blank.
**Snapshot-age rule:** if the newest snapshot is older than **one trading day**, treat this as SEV-2 and ask the owner to decide between (a) accepting clearly-labelled stale-price trading or (b) disabling paper trading for the duration — do not leave multi-day-stale execution running silently.

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
- If snapshots grow older than a trading day, the snapshot-age rule above applies (owner decision on trading), and pause the ranking refresh announcement rather than serving misleading ranks.

## Rollback
Not applicable.

## Validation
Endpoints return live availability again; ranking job next run succeeds (`scheduler-failure.md` diagnostics); UI staleness banners clear.

## Communication
In-app staleness indicators carry it; status note only if multi-day.

## Post-incident
Log the outage window; verify no paper trades executed against absurd stale prices (spot-check `trading.trade_journal` entries in the window).
