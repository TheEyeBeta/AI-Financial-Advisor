# ADR-003: Supabase Over Firebase or Self-Hosted PostgreSQL
## Status
Accepted

## Context
The application needs authentication, row-level permissions, relational data, and client-side access to a structured database. The frontend already uses schema-qualified Supabase clients, and the backend uses service-role access for trusted operations. The system also benefits from managed hosting so the team can move quickly without operating its own database stack.

## Decision
Use Supabase instead of Firebase or a self-hosted PostgreSQL deployment.

## Consequences
Supabase gives us PostgreSQL semantics, RLS, auth integration, and a consistent API surface for both frontend and backend code. That fits the existing data model much better than Firebase's document-first design. It also avoids building and operating our own auth, database, and access layer from scratch.

Compared with self-hosted PostgreSQL, Supabase reduces infrastructure burden and speeds up iteration. The tradeoff is platform dependence: schema exposure, RLS behavior, and some operational controls live in Supabase's managed environment. We also accept that certain tasks, like migration versioning and schema verification, must be handled explicitly in repo tooling instead of delegated to a full framework.

Firebase would simplify some realtime use cases, but this repo is not built around document sync. The current workload is relational and policy-heavy, so PostgreSQL is the correct base.
