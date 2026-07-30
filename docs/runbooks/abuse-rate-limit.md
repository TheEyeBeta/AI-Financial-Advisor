# Runbook: Abuse / rate-limit incident

**Rehearsed:** NO

- **Trigger:** abuse-detection blocks firing (>50 req/min auto-block), sustained 429 volume, cost spike attribution, scraping patterns, credential-stuffing signature in auth logs.
- **Severity:** SEV-3 (contained by limits) / SEV-2 (limits being evaded or degrading service for legitimate users).
- **User impact:** legitimate users can be collateral damage of IP-level blocks (shared NATs).

## Immediate containment
1. The system self-contains first: per-user/IP request+token limits, concurrent cap, auto-block (1 h) — confirm they're actually engaging (429s + block events in logs) rather than assuming.
2. Authenticated abuser: **suspend the account** (audited lifecycle endpoint) — user-keyed limits make account suspension the clean lever.
3. Unauthenticated/IP-rotating: verify Valkey-backed (Redis-protocol-compatible) shared limits are active (`redis-unavailable.md` if not — process-local limits are evadable across replicas).
4. Signup-wave abuse: pause invitations/registrations per `../readiness/STAGED_LAUNCH.md` admission controls.

## Diagnostics
- Rate-limit state and block events in backend logs; abuse thresholds in `app/services/rate_limit.py` (`docs/RATE_LIMITING.md` for the configured numbers).
- Pattern: one user, one IP, IP rotation, or many fresh accounts? (auth logs + audit log).
- Cross-check provider spend (`cost-spike.md`) — abuse and cost incidents usually co-occur.

## Dashboards / logs
Railway logs, Supabase Auth logs, Sentry, provider usage dashboards.

## Recovery
- Tighten specific endpoint limits via config PR if the abuse fit inside current ceilings (never loosen under pressure).
- Persistent distributed abuse: platform-level controls (Vercel/Railway WAF options) — EXTERNAL, owner action.
- Unblock collateral users by lifting specific blocks (block store is TTL'd; targeted removal via Valkey if urgent).

## Rollback
Not applicable.

## Validation
429/block rate returns to baseline; legitimate-user error reports stop; spend normal.

## Communication
Affected legitimate users individually if they were collateral-blocked.

## Post-incident
Record the pattern; if evasion succeeded, that's a finding for the security review package (rules-of-engagement §5 covers rate-limit validation); revisit G-1 global caps in `docs/ai/AI_CONTROLS.md`.
