# ADR-002: Six PostgreSQL Schemas Over One Flat Schema
## Status
Accepted

## Context
The database is organized into `core`, `ai`, `trading`, `market`, `academy`, and `meridian`. The app spans user identity, AI chat, paper trading, market data, educational content, and personalized planning. The current SQL history and client code already reference schema-qualified tables across those domains.

## Decision
Keep six schemas rather than collapsing everything into one flat schema.

## Consequences
Schema separation gives each domain a clear boundary and reduces accidental coupling. It also makes RLS policy intent easier to read because permissions are attached to the domain they protect. The layout matches the frontend and backend service boundaries, so query code can be grouped by responsibility instead of by a generic table list.

The downside is operational complexity. Cross-schema joins are more verbose, migrations are harder to reason about, and Supabase exposure/GRANT configuration must be maintained carefully. A flat schema would be easier for ad hoc querying, but it would blur boundaries between security-sensitive user data, public market data, and generated AI context.

This choice favors maintainability and access control over raw convenience. It only works if schema ownership remains disciplined and if migration history is versioned, which is why Alembic and readiness checks are part of the same workstream.
