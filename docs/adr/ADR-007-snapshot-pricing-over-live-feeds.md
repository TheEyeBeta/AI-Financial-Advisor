# ADR-007: Snapshot Pricing Over Live Feeds for Paper Trading
## Status
Accepted

## Context
Paper trading in this repo builds portfolio state from journaled trades and uses market snapshots to value open positions. The frontend already hydrates positions from `market.stock_snapshots`, and the ledger logic treats snapshot prices as the source of truth for performance calculation. Live feeds would introduce higher operational cost and more brittle timing behavior.

## Decision
Value paper trading with snapshot pricing instead of live intraday feeds.

## Consequences
Snapshot pricing makes the simulator deterministic, easier to test, and cheaper to operate. It also keeps paper-trade performance aligned with the rest of the app's cached market data model. Users get consistent numbers even if live market APIs are down or delayed.

The tradeoff is that paper trading is not a true live execution simulator. Intraday slippage, spread, and tick-level movement are not represented. That limitation is acceptable because this feature is for education and portfolio journaling, not broker-grade execution.

If we later add live trading or market replay, it should be a separate path with explicit latency and fill assumptions rather than a silent upgrade to the current simulator.
