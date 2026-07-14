# Critical journeys — coverage matrix (Phase 2 audit)

**Owner:** TheEyeBeta · **Started:** 2026-07-14 · **Status:** first-pass, evidence-based, incomplete.

This is a living audit against the Phase 2 critical-journey checklist. Each row
cites the actual test file/function found in the repo, or is marked `GAP` when
none was found. Items marked `NOT YET AUDITED` were not checked in this pass —
treat them as unknown, not as covered.

Do not treat a `GAP` here as urgent by default — triage against real user risk
before spending effort. This document's job is to make the unknowns visible,
not to prescribe order.

## Authentication

| Journey | Level 1/2 evidence | Level 3 (E2E) evidence | Status |
|---|---|---|---|
| Email registration | `test_auth_functions.py`, `test_auth_service.py` | `e2e/journeys/onboarding.spec.ts` (post-signup redirect only) | Partial |
| Email verification | — | — | GAP |
| Email sign-in | `integration/test_auth.py`, `use-auth.test.tsx`, `SignInDialog.test.tsx` | `e2e/utils/sign-in.ts` used across journeys | Covered |
| Google sign-in | — | `e2e/journeys/google-auth.spec.ts` (46 lines, 1 test — mocked OAuth) | Partial |
| Password reset | `src/pages/ResetPassword.tsx` exists; no dedicated test found | — | GAP |
| Sign-out | `use-auth.test.tsx` | — | Partial |
| Expired session | `test_user_account_lifecycle.py::test_stale_session_forbidden` (admin re-auth only, not general session expiry) | — | GAP (general case) |
| OAuth cancellation | — | — | GAP |
| Duplicate-email identity linking | — | — | GAP |

## Onboarding

| Journey | Evidence | Status |
|---|---|---|
| New user reaches onboarding | `e2e/journeys/onboarding.spec.ts:5` | Covered |
| Incomplete user cannot bypass onboarding | `ProtectedRoute.test.tsx` (onboarding redirect logic) | Covered |
| All five onboarding steps save | **Was a complete gap: `Onboarding.tsx` only wrote to the database once, at final submit on step 5 — steps 1-4 were React state only.** Fixed this session: `saveStepProgress()` upserts `core.user_profiles` after each of steps 1, 2, 3 (risk quiz), 4; step 5 (goals) persists at final submit alongside `onboarding_complete`, matching the existing single-shot goals-insert design. Test: `src/pages/__tests__/Onboarding.test.tsx::persists step 4`. | Covered (new) |
| Refresh during onboarding does not destroy progress | Fixed alongside the above: on mount, `Onboarding.tsx` now loads any partial `user_profiles` row and resumes at the first incomplete step instead of restarting at step 1. This also fixed a latent bug where the old "already complete" gate keyed off *row existence* rather than `onboarding_complete` — once partial rows exist, that gate would have falsely told a mid-onboarding user they were done; it now keys off `onboardingComplete` from `AuthContext`. Tests: `Onboarding.test.tsx::starts fresh`, `::resumes at step 3`, `::resumes at step 5`. | Covered (new) |
| Completion changes `onboarding_complete` exactly once | `handleSubmit` sets it in a single guarded UPDATE; `isSubmitting` prevents double-fire from the same click, and the `onboardingComplete === true` redirect effect prevents re-entry once set. No direct test asserting exactly-once semantics under e.g. a double-tap or two-tab race. | Partial |
| Returning user does not repeat onboarding | `onboardingComplete === true` redirect effect (`Onboarding.tsx`) + `ProtectedRoute` gate | Covered |

## IRIS (AI chat)

| Journey | Evidence | Status |
|---|---|---|
| Create conversation | `e2e/journeys/ai-advisor.spec.ts:4` | Covered |
| Send message / receive streamed answer | `e2e/journeys/ai-advisor.spec.ts:4`, `integration/test_chat_flow.py` | Covered |
| Refresh and retain conversation | — | NOT YET AUDITED |
| Provider timeout | `test_chat_turn_reconciliation.py` (stale-turn reconciliation, not a live timeout path) | Partial |
| Provider rejection | `test_ai_proxy.py` (error handling cases) | Partial |
| User retry | — | GAP |
| Rate-limit response | `integration/test_rate_limiting.py`, `test_rate_limit*.py` (extensive) | Covered |
| Concurrent-submit prevention | Already implemented in the frontend (`Advisor.tsx`: `isSendingRef` synchronous guard checked before React state updates, composer `disabled={isLoading}` while `sendMessageMutation.isPending`) plus backend idempotency (`ai.chat_turn_requests`, `idempotencyKey` in `useSendChatMessage`). No test exercises this — `Advisor.tsx` has zero test coverage of any kind (no `Advisor.test.tsx` exists). Not attempted this session: the component is large (streaming, multiple query hooks) and deserves a properly scoped test file rather than a rushed one. | Partial (implemented, untested) |

## Paper trading

| Journey | Evidence | Status |
|---|---|---|
| Create order | `e2e/journeys/paper-trading.spec.ts:5` | Covered |
| Reject invalid quantity | `test_trading_constraints_db.py::TestPositiveValueConstraints` | Covered |
| Reject insufficient cash | **Not a test gap — a product gap.** There is no cash-balance concept anywhere in the schema, backend, or frontend (`trading.paper_trades`/`trading.trade_journal` track positions directly; nothing debits or credits a cash pool on buy/sell). This journey can't be tested because the feature it describes doesn't exist. Implementing it means deciding a starting balance, whether it's per-user/configurable, and a migration + constraint/trigger to enforce it — a product decision, not a test-writing task. Flagging for a human call rather than inventing a design. | GAP (needs product decision first) |
| Prevent overselling | `test_trading_constraints_db.py::TestOversellProtection` (incl. concurrent-sell race) | Covered |
| Persist completed order | `e2e/journeys/paper-trading.spec.ts:5` | Covered |
| Correct portfolio totals | — | NOT YET AUDITED |
| Concurrent-order handling | `test_trading_constraints_db.py::test_concurrent_sells_cannot_both_pass` | Covered |
| Market-data unavailable state | `test_trade_engine.py` (503/502 paths for DataAPI unavailability) | Covered |

## Academy

| Journey | Evidence | Status |
|---|---|---|
| Load course / open lesson | `e2e/journeys/academy.spec.ts:5` | Covered |
| Record progress | `e2e/journeys/academy.spec.ts:5` (quiz flow) | Partial |
| Resume progress | — | GAP |
| Complete lesson | — | NOT YET AUDITED |
| Handle missing content | — | GAP |

## Account management

| Journey | Evidence | Status |
|---|---|---|
| Update profile | — | NOT YET AUDITED |
| Suspend account | `test_user_account_lifecycle.py` (guards only, before this change); route itself untested before this change | Partial (guards covered; now includes route test — see below) |
| Restore account | **Was a complete gap: no `restore_user_account` function, no route, no frontend button existed.** Implemented this session: `app/services/user_account_lifecycle.py::restore_user_account`, `POST /api/admin/users/{auth_id}/restore`, `src/pages/Admin.tsx` Restore button. Tests: `test_user_account_lifecycle.py` (4 cases), `test_admin_routes.py::TestRestoreUserRoute` (3 cases). | Covered (new) |
| Delete-account request | `test_admin_triggers.py`, delete-request/execute flow exists; route-level tests not found | Partial |
| Admin cannot delete self/final admin | `test_user_account_lifecycle.py::test_self_delete_forbidden`, `test_final_admin_delete_forbidden` | Covered |
| Audit record produced | **Was a gap: `audit_log()` existed (`app/services/audit.py`) but suspend/restore/delete-execute never called it — only plain `logger.info`, which isn't a durable/queryable audit trail.** Fixed this session: `suspend_user_account`, `restore_user_account`, and `execute_delete_request` now call `audit_log()` with actor/target/reason on every success path (including the already-removed idempotent-replay branch of delete). Tests assert the call and its payload in `test_user_account_lifecycle.py`. | Covered (new) |

## How to use this document

- Before closing a `GAP`, add the test at the appropriate level (unit for pure
  logic, integration for DB/transaction behavior, E2E for the full browser
  path) per `AGENTS.md` §4 and this repo's existing patterns in
  `backend/websearch_service/tests/` and `e2e/journeys/`.
- Re-run this audit (or extend it) rather than trusting it as permanently
  accurate — it reflects a single pass on 2026-07-14 and the codebase moves
  faster than this file will be updated.
- `NOT YET AUDITED` rows need someone to actually search before being
  reclassified — do not assume they're covered or missing.
