---
name: auth-boundary-review
description: >-
  Review or implement auth-boundary-sensitive changes across frontend, backend, and
  database access paths while preserving JWT verification and RLS guarantees.
---

# Skill: auth-boundary-review

## When to use

- JWT identity, role checks, or protected endpoint behavior changes.
- Supabase access-path changes that can affect data exposure.
- Tasks requiring explicit unauthorized/wrong-role/correct-role scenario validation.

## Do not use for

- Pure UI cosmetics with no auth/data path changes.
- Generic backend work unrelated to auth/authorization.

## Primary procedure

Use `skills/supabase-rls-auth-review/SKILL.md` as the authoritative workflow for:

- Threat-model framing and auth invariants.
- Allowed file scope and required reading.
- Required commands, forbidden actions, and final evidence format.

## Required scenario checks

1. Unauthenticated request is denied.
2. Authenticated request without required role is denied.
3. Authorized role succeeds on intended resource.
4. Cross-tenant access attempt is blocked.
