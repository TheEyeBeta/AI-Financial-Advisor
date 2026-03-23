# ADR-001: FastAPI Over Django or Express
## Status
Accepted

## Context
The backend in this repository is a Python service that exposes AI proxy, search, trade-engine, and Meridian endpoints. It already depends on Python-native libraries for auth, Supabase access, HTTP clients, and background scheduling. The service needs async request handling, clear request models, and a small deployment surface.

## Decision
Use FastAPI for the backend instead of Django or Express.

## Consequences
FastAPI fits the existing Python stack and keeps request/response contracts explicit through Pydantic models. Async I/O is a natural fit for OpenAI, Perplexity, Tavily, and Supabase calls. It is also lightweight enough that the service can stay focused on API orchestration rather than a large framework.

The tradeoff is that FastAPI does not give us Django-style batteries-included admin, ORM, or migration tooling. That is acceptable here because the backend is intentionally not the system of record for the database, and the repo already uses Supabase as the persistence layer. Compared with Express, FastAPI avoids duplicating a second language/runtime and keeps the AI-heavy code closer to the Python ecosystem.

We pay a small cost in framework-level conventions: the team must be disciplined about routing, dependency injection, and validation. The benefit is less hidden behavior and easier reasoning about external provider calls, rate limiting, and middleware.
