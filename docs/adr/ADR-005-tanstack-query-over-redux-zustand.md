# ADR-005: TanStack Query Over Redux or Zustand
## Status
Accepted

## Context
The frontend reads from Supabase-backed APIs and backend endpoints for data such as chats, market data, trading state, and learning progress. Most of that state is server-owned and cacheable. The app benefits more from request caching, invalidation, background refetching, and loading-state ergonomics than from a large client-owned store.

## Decision
Use TanStack Query for server state instead of Redux or Zustand.

## Consequences
TanStack Query matches the data shape of this app: remote, asynchronous, and frequently revalidated. It reduces boilerplate compared with Redux and avoids turning server data into duplicated client state. It also keeps stale data and refetch behavior explicit, which matters for trading and market views.

The tradeoff is that TanStack Query is not a general replacement for local UI state or complex cross-tab event buses. For that, small component state or a narrower store can still be appropriate. A Redux setup would be heavier than necessary, and a Zustand store would not solve the caching and invalidation problems this app actually has.

This decision keeps the frontend simpler as long as we respect the boundary between server state and UI state.
