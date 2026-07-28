# Architecture patterns — reference

Loaded by `architecture-advisor` when making a specific pattern
recommendation. Each section: structure, concrete use cases with reasoning,
when NOT to use it, and trade-offs. The "when NOT to" sections matter as
much as the use cases — they're what stop a bad recommendation.

## Contents

1. [Layered (N-Tier) Architecture](#1-layered-n-tier-architecture)
2. [Modular Monolith](#2-modular-monolith)
3. [Microservices](#3-microservices)
4. [Domain-Driven Design](#4-domain-driven-design-ddd)
5. [Hexagonal / Ports & Adapters](#5-hexagonal--ports--adapters)
6. [CQRS](#6-cqrs-commandquery-responsibility-segregation)
7. [Event Sourcing](#7-event-sourcing)
8. [Event-Driven vs Request-Response](#8-event-driven-architecture-eda-vs-request-response)
9. [Saga Pattern](#9-saga-pattern-distributed-transactions)

---

## 1. Layered (N-Tier) Architecture

**Structure**: Presentation/API → Application/service → Domain → Infrastructure.
Dependencies generally flow downward; simple transactional boundaries,
usually one database.

**Use it when**
- Internal enterprise systems (ERP, CRM, line-of-business apps): heavy
  CRUD, stable domain, one team or a few tightly collaborating teams.
  Layering makes business logic vs persistence vs UI easy to reason about,
  and a single DB keeps transactions simple.
- Banking/financial back-office systems that are non-real-time: strong
  consistency needs but not extreme scale. Centralized transaction
  management and a single codebase make security/authorization/audit
  easier to enforce.
- Legacy modernization where a rewrite isn't affordable: an existing big
  ball of mud can be refactored into clear layers incrementally, which is
  lower risk than jumping straight to microservices.

**Avoid it when**
- Highly scalable consumer products with spiky loads (flash sales, social
  feeds) — you're forced to scale the entire app even when only one
  feature is hot; layered monoliths don't scale granularly.
- Many independent teams with different release cadences (20+ product
  teams) — coordination overhead and cross-team breakage grow fast.
- Subdomains that clearly evolve independently (billing, notifications,
  fraud detection, recommendations) — a layered monolith with a shared DB
  makes independent evolution painful.

**Trade-offs**: simple, familiar, easy debugging, centralized transactions
— at the cost of coarse-grained scaling, tighter coupling, and risk of
degrading into an unenforced "big ball of mud" without discipline.

---

## 2. Modular Monolith

Often the senior architect's default starting point before microservices.

**Structure**: still one deployable unit, but internally split into
modules aligned with domain subdomains (`ordering`, `billing`,
`inventory`). Each module has its own internal layering and communicates
with others through explicit interfaces, not free-form cross-codebase
calls. Frequently combined with hexagonal/clean architecture inside each
module.

**Use it when**
- A startup or mid-stage product has growing complexity but doesn't yet
  need the operational burden of microservices.
- You anticipate future microservices but want to learn the domain first
  — design modules around bounded contexts (DDD) so they can be extracted
  later without redesigning boundaries.
- Team size is roughly 10–40 developers: large enough that an
  unstructured codebase is dangerous, not large enough to justify dozens
  of independently-run services.

**Avoid it when**
- A specific capability needs to scale independently (e.g. recommendations
  at 10x the rest of the system) — a monolith scales everything together.
- Multiple teams have conflicting release priorities you can't coordinate
  — you may need real organizational decoupling (microservices).
- Different capabilities genuinely need different tech stacks (ML in
  Python, ledger in Java, real-time in Go) — one deployment unit usually
  forces a dominant stack.

**Trade-offs**: modularity without distributed complexity, easier later
extraction into microservices, simpler ops — at the cost of still being
one deployment artifact, limited tech diversity, and coarse-grained
scaling.

---

## 3. Microservices

**Structure**: independently deployable services, each owning its own
codebase, data store, and deployment pipeline. Communication via sync
APIs (REST/gRPC/GraphQL) or async messaging (Kafka/RabbitMQ/SQS).

**Use it when**
- Large-scale platforms with subdomains that have genuinely different
  load profiles (search/recommendations read-heavy, checkout write-heavy
  and critical) and benefit from independent scaling, deployment, and
  team ownership.
- Multi-tenant SaaS with per-tenant customization — isolate heavy tenants
  or custom features into their own services; iterate on one capability
  without touching others.
- Platforms with mixed latency/consistency requirements (e.g. a trading
  platform where order entry must be low-latency and strongly consistent,
  while analytics/reporting can be eventually consistent and batch) — each
  service can pick its own storage and consistency model.

**Avoid it when**
- Early-stage startup with <10 engineers and an unclear domain — you
  don't yet know your real bounded contexts, and microservices lock in
  premature boundaries at high operational cost.
- The problem is a simple CRUD app or internal tool a well-structured
  monolith would solve — microservices here is over-engineering.
- The team lacks strong DevOps/platform engineering: microservices
  require CI/CD, containerization, orchestration, and real observability
  (logging/metrics/tracing). Without that maturity, operational complexity
  will dominate.

**Trade-offs**: independent scaling and deployment, better fault
isolation, team autonomy — at the cost of distributed complexity, eventual
consistency, harder debugging, and heavier infra/ops burden.

---

## 4. Domain-Driven Design (DDD)

Not an architecture style on its own — a design approach that informs how
monoliths or microservices get structured.

**Core concepts**: bounded contexts (explicit model boundaries where terms
have specific meaning), aggregates (entity/value-object clusters treated
as a consistency boundary), domain events (facts used for integration and
internal logic), ubiquitous language (shared terminology between
engineers and domain experts).

**Use it when**
- The business domain is genuinely complex with rich rules (insurance
  underwriting, loan origination, freight logistics, healthcare claims) —
  DDD models the real business instead of just data tables, and aggregates
  clarify transactional boundaries and future service splits.
- You're planning an eventual monolith → microservices evolution — design
  modules around bounded contexts from day one so extraction later needs
  minimal rework.
- The system is long-lived with changing requirements — a domain-first
  (not tech-first) focus makes it easier to adapt as the business changes.

**Avoid going deep when**
- The app is simple CRUD with trivial business logic (basic admin
  dashboards, simple CMS) — full DDD costs more modeling time than it
  returns in value.
- There's no access to domain experts — DDD depends on close
  collaboration with the business; without it you risk an elaborate but
  misaligned model.

**Trade-offs**: clearer domain model, better business alignment, easier
evolution — at the cost of a learning curve, risk of over-modeling, and
real weight for simple domains.

---

## 5. Hexagonal / Ports & Adapters / Clean / Onion Architecture

Variations on the same idea: protect the domain core, push tech details to
the edges.

**Structure**: Core (domain + application/use-case logic) ← Ports
(interfaces defining how the outside world interacts with the core, e.g.
`OrderRepository`, `PaymentGateway`) ← Adapters (concrete implementations
— JPA repository, REST controller, Kafka producer/consumer). Dependencies
point inward; the core depends on nothing external.

**Use it when**
- The system must stay technology-agnostic — you might swap DB (Postgres
  → Mongo), transport (REST → gRPC → messaging), or UI (web → mobile), and
  the core logic shouldn't have to change.
- Domain logic is complex and must be highly testable — core and
  application layers can be tested in isolation with in-memory adapters.
  Strong fit for pricing engines, risk engines, and similar intricate
  rule sets.
- The product is expected to have a long lifetime and multiple
  re-platformings (e.g. a core banking engine that will outlive any given
  framework or database).

**Avoid it when**
- The app is simple CRUD with no expectation of major tech change — the
  extra abstraction adds cognitive load without a real payoff.
- The team is new to the pattern with no architectural guidance — risk of
  it degrading into "layered soup" with too many interfaces and no clarity.

**Trade-offs**: testability, tech independence, clear separation of
concerns — at the cost of more boilerplate, more files, and real weight
for small systems.

---

## 6. CQRS (Command–Query Responsibility Segregation)

**Structure**: Commands mutate state; queries read state, often via a
separate model optimized for reads. Read and write sides can have
different schemas, different databases, and different scaling strategies.

**Use it when**
- Read and write patterns are very different (a social feed: infrequent
  writes — posts, likes — versus extremely frequent reads — timeline
  loads) — the read model can be denormalized/cached independently of a
  clean, consistent write model.
- Complex reporting/analytics sits on top of transactional data (e-commerce
  dashboards, fraud analytics) — the write model stays clean for business
  logic while the read model is tuned purely for query performance.
- A collaborative domain needs multiple views of the same data (a project
  tool with per-user task lists, team workload views, and executive
  summaries) — each view can be its own read model.

**Avoid it when**
- The app is simple CRUD with symmetric, simple reads and writes — CQRS
  adds complexity with no real gain.
- The team has no experience with eventual consistency — CQRS usually
  implies read and write models aren't instantly in sync; if the domain
  can't tolerate that, it creates confusion and bugs.

**Trade-offs**: independent scaling of reads/writes, optimized query
models, clearer separation — at the cost of eventual consistency, extra
infrastructure (projections, read DBs), and a more complex mental model.

---

## 7. Event Sourcing

**Structure**: instead of storing current state, store a sequence of
events (`OrderCreated`, `OrderModified`, `OrderCancelled`, …); current
state is derived by replaying events. Often combined with CQRS — an event
store for writes, projections (read models) for queries.

**Use it when**
- The domain is audit-heavy (financial ledgers, trading systems, health
  records, compliance systems) — a full history of changes is inherent to
  the storage model, not bolted on.
- Workflows are collaborative with complex state transitions (claim
  processing, loan approval) — events capture the narrative of what
  happened, not just the final state.
- The system needs temporal queries or "what-if" analysis ("what was the
  customer's balance last Friday at 3pm?") — event logs make this
  possible where a current-state table can't.

**Avoid it when**
- It's simple CRUD with no need for history — event sourcing is heavy
  machinery for a need that doesn't exist.
- The team lacks discipline around schema evolution and projections —
  events are immutable, so changing their structure over time (versioning,
  upcasting, projection rebuilds) is genuinely non-trivial and easy to get
  wrong.

**Trade-offs**: full audit trail, temporal queries, natural fit with
domain events and CQRS — at the cost of complex storage/querying, harder
reasoning about "current state," and real operational overhead.

---

## 8. Event-Driven Architecture (EDA) vs Request-Response

### Request-response (synchronous)
Service A calls Service B (HTTP/gRPC) and waits for the response. Common
in REST/RPC/GraphQL.

**Use it when**
- Interactions are simple and low-latency (user login, product detail
  fetch) — straightforward to understand, debug, and reason about latency.
- Consistency must be immediate — e.g. payment authorization, where the
  caller needs to know right away whether it succeeded.

**Avoid relying on it alone when**
- One action has high fan-out (a signup must trigger a welcome email,
  analytics event, fraud check, and recommendation-engine init) — pure
  request-response forces the signup service to call all of them directly,
  coupling and slowing it down.
- You want temporal decoupling — producers and consumers shouldn't have
  to be up at the same time; messages should be able to buffer.

### Event-driven architecture
Services publish events; other services subscribe and react, typically via
a broker (Kafka, RabbitMQ, SQS).

**Use it when**
- Real-time data pipelines / streaming (clickstream analytics, IoT
  telemetry, transaction fraud detection) — this is a natural fit for
  streams, and multiple consumers can process the same stream
  independently.
- Integrating decoupled microservices around a business process (order
  placed → inventory reserved → payment captured → shipping scheduled →
  notification sent), where each step is its own service reacting to
  events.
- High resilience and back-pressure handling matter — a slow or down
  consumer causes messages to queue rather than failing the producer.

**Avoid it as the primary style when**
- The system is simple with only 2–3 integrations — EDA is overkill at
  that scale.
- The team lacks experience with eventual consistency and message
  semantics — at-least-once vs exactly-once, idempotency, ordering
  guarantees, poison messages and retries all need to be understood, not
  assumed away.

**Trade-offs**: request-response is simpler and synchronous but couples
services in time and space; EDA decouples and scales but is more complex,
eventually consistent, and harder to trace end-to-end.

---

## 9. Saga Pattern (Distributed Transactions)

Used when a business transaction spans multiple services, each with its
own database. Two main styles:

### Orchestration
A central saga orchestrator tells each service what to do (e.g. send
`ReserveCredit` to Customer Service, then on success `CreateOrder` to
Order Service, and on failure send compensating commands to roll back
prior steps).

**Use it when**
- The workflow is complex with many steps and conditional logic (e.g.
  travel booking: flight + hotel + car + insurance) — a central place to
  encode the workflow and compensation logic is easier to understand and
  modify.
- You need strong visibility into where each transaction currently stands
  — you can inspect orchestrator state directly.

### Choreography
No central coordinator. Each service performs its local transaction, emits
an event, and other services react; compensation is also event-driven.

**Use it when**
- The workflow is simpler with few services (order → payment → inventory)
  — less infrastructure (no orchestrator service), more decentralized and
  flexible.
- Maximum decoupling matters — services only know about events, not the
  entire workflow.

**Avoid sagas altogether when**
- The transaction can stay inside a single service/DB — always prefer a
  local ACID transaction if you can keep it there.
- The team can't handle eventual consistency — sagas imply the system
  will sit in an intermediate state at points, and that has to be
  acceptable to the business.

**Trade-offs**: orchestration gives a clearer workflow and easier logic
changes, but introduces a central component and potential bottleneck.
Choreography is more decoupled, but workflow logic is distributed and
harder to see as a whole.
