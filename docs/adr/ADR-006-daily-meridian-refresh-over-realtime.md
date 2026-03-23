# ADR-006: Daily Meridian Context Refresh Over Real-Time Sync
## Status
Accepted

## Context
Meridian builds personalized context from profile data, goals, alerts, and plan status, then writes the result into `ai.iris_context_cache`. The backend already schedules a daily refresh and can refresh on demand after onboarding or explicit updates. The context is useful for conversational personalization, but it does not need second-by-second freshness.

## Decision
Refresh Meridian context daily instead of attempting real-time synchronization for all sources.

## Consequences
Daily refresh keeps the system simpler and cheaper. It avoids turning every profile or goal update into a chain of realtime invalidations and reduces the chance of partial updates causing inconsistent AI context. For a planning layer, bounded staleness is acceptable because the data changes slowly relative to chat traffic.

The tradeoff is that the cache can be stale between refreshes. We mitigate that with explicit refreshes after onboarding and other meaningful user actions. If the product later needs live risk or portfolio state, that should be handled as a separate real-time feed, not by forcing Meridian to do everything.

This choice favors predictability and operational reliability over instant consistency.
