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
| Password reset | **Was broken, not just untested.** `ResetPassword.tsx` had two real bugs: (1) its link-validity check only recognized `#access_token` hash tokens, but this project's Supabase client uses the default PKCE flow (`?code=` param) — the shared `hasAuthCallbackParams()` helper already handles both and is used correctly by the OAuth callback, but `ResetPassword.tsx` reimplemented a narrower check that missed `code` entirely, meaning legitimate reset links were likely rejected as "invalid" before the user could set a password. (2) Its JS length check required 6 characters while the UI/`minLength` and sign-up's canonical rule both require 10 — inconsistent, and would accept a password the UI claims is too short if HTML validation were ever bypassed. Both fixed this session. Tests: `src/pages/__tests__/ResetPassword.test.tsx` (invalid link, valid `?code=` link, length rejection, mismatch rejection, success path). | `ResetPassword.test.tsx` (5 tests) | Covered (was broken; now fixed + tested) |
| Sign-out | `use-auth.test.tsx` | — | Partial |
| Expired session | `test_user_account_lifecycle.py::test_stale_session_forbidden` (admin re-auth only, not general session expiry) | — | GAP (general case) |
| OAuth cancellation | Already implemented and tested: `getOAuthErrorMessage('access_denied', ...)` → "cancelled" message (`src/lib/auth-callback.ts`), wired into `use-auth-callback-session.ts` (`phase: 'error'`), asserted in `src/lib/__tests__/auth-callback.test.ts`. | `e2e/journeys/google-auth.spec.ts` covers the sign-in UI but not the actual `?error=access_denied` redirect path — E2E coverage of the cancellation redirect itself is thin. | Covered (unit); E2E thin |
| Duplicate-email identity linking | Investigated: no explicit identity-linking logic found anywhere in `src/` or `backend/`. Supabase Auth's default behavior for a Google sign-in matching an existing email/password account depends on the **"Manual Linking" / account-linking dashboard setting** in the Supabase project, which is infra configuration this repo doesn't control or document. Whether a duplicate-email Google sign-in links to the existing account or errors is currently undefined by the codebase — worth a deliberate decision + test once the Supabase-side behavior is confirmed, not something to guess at here. | — | GAP (depends on Supabase project config, not app code) |

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
| User retry | **Not implemented, and the workaround has a real risk.** No retry UI exists in `Advisor.tsx` — a failed send just shows a static error banner (`sendError`, no retry button). The schema has a `retry_of_request_id` column (`ai.chat_turn_requests`) built for exactly this, but nothing in the frontend or backend ever sets it — it's dead. The de facto retry path is "the user retypes and resends the same text," but `chatApi.addMessage` (the user message write) happens *before* the AI call and its `idempotencyKey` is freshly randomized per `handleSendMessage` call (`crypto.randomUUID()` in `Advisor.tsx`) — so a failed attempt already persists the user's message, and resending the identical text creates a **second, duplicate user message**, which directly conflicts with Phase 4's explicit pass criterion ("no duplicate chat messages"). Not fixed this session: a correct fix means deciding whether retry reuses the original user-message row, how many retries are allowed, and how `retry_of_request_id` should actually be populated — a deliberate design decision, not a same-shape-as-existing-pattern fix like the ones made this session. Flagging with full mechanism detail rather than guessing at a design. | GAP (real risk of duplicate messages on manual retry — needs a design decision) |
| Rate-limit response | `integration/test_rate_limiting.py`, `test_rate_limit*.py` (extensive) | Covered |
| Concurrent-submit prevention | Already implemented in the frontend (`Advisor.tsx`: `isSendingRef` synchronous guard checked before React state updates, composer `disabled={isLoading}` while `sendMessageMutation.isPending`) plus backend idempotency (`ai.chat_turn_requests`, `idempotencyKey` in `useSendChatMessage`). No test exercises this — `Advisor.tsx` has zero test coverage of any kind (no `Advisor.test.tsx` exists). Not attempted this session: the component is large (streaming, multiple query hooks) and deserves a properly scoped test file rather than a rushed one. | Partial (implemented, untested) |

## Paper trading

| Journey | Evidence | Status |
|---|---|---|
| Create order | `e2e/journeys/paper-trading.spec.ts:5` | Covered |
| Reject invalid quantity | `test_trading_constraints_db.py::TestPositiveValueConstraints` | Covered |
| Reject insufficient cash | **Correction of an earlier note in this file:** there IS a cash-balance concept — `paper-trading-ledger.ts` tracks `cashBalance` — but it deliberately auto-funds any shortfall rather than rejecting the trade (see "Persist completed order" above; this is what the now-fixed bug was rooted in). No schema-level cash column exists (`trading.paper_trades`/`trading.trade_journal` don't debit/credit a persisted balance; cash is a derived, in-memory value recomputed from journal history on every rebuild). Whether "reject insufficient cash" should replace the current unlimited-virtual-capital design is a genuine product decision — the auto-fund behavior looks deliberate (a practice tool where users track P&L without an artificial budget wall), not an oversight. Not changing this without a human call. | GAP (existing behavior looks intentional — needs a product decision, not an assumption) |
| Prevent overselling | `test_trading_constraints_db.py::TestOversellProtection` (incl. concurrent-sell race) | Covered |
| Persist completed order | **Was severely broken.** `rebuildPaperTradingState` (`paper-trading-sync.ts`), called after every journal entry creation in `TradeJournal.tsx`, threw for essentially every real trade: `buildPaperTradingLedger` starts `cashBalance` at 0 and auto-funds any BUY that exceeds it (intentional — paper trading has no funding cap), but recorded that as an "Auto-funded..." entry in the same `errors` array used for genuinely-fatal per-entry problems. The caller treated any non-empty `errors` as fatal and discarded the whole rebuild — so the journal entry (order) saved, but positions/trades/portfolio_history never did, and the user got a "Partial Success ... account rebuild failed" toast on what should have been an ordinary buy. The ledger's own test suite documented this exact auto-fund path as expected-success behavior, which is how the mismatch became visible. Fixed this session: added a separate `warnings` field for non-fatal notices; `errors` now only contains genuinely-skipped-entry problems. Tests: `src/lib/__tests__/paper-trading-ledger.test.ts` (updated), `src/services/__tests__/paper-trading-sync.test.ts` (new regression test). | Covered (was broken; now fixed + tested) |
| Correct portfolio totals | Directly follows from the bug above — positions/trades/portfolio_history were never persisted on the common path, so totals were wrong/stale for any account with real trade history. Fixed alongside "Persist completed order". `paper-trading-ledger.test.ts` also has direct math assertions (market value, unrealized P&L, invested capital, account value) from the pre-existing tests. | Covered |
| Concurrent-order handling | `test_trading_constraints_db.py::test_concurrent_sells_cannot_both_pass` | Covered |
| Market-data unavailable state | `test_trade_engine.py` (503/502 paths for DataAPI unavailability) | Covered |

## Academy

| Journey | Evidence | Status |
|---|---|---|
| Load course / open lesson | `e2e/journeys/academy.spec.ts:5` | Covered |
| Record progress | `e2e/journeys/academy.spec.ts:5` (quiz flow) | Partial |
| Resume progress | Investigated: implemented via `academyApi.getUserLessonProgress` + `getBestQuizAttempt` in `AcademyLesson.tsx` (`loadLesson`, lines ~410-471) — reopening a lesson restores `in_progress`/`completed` status and best quiz score across sessions. Untested at any level; `AcademyLesson.tsx` (749 lines) has zero test coverage of any kind, and `academy-api.ts` (17 exports) also has none. Not attempted this session — a rushed test of a component this size risks being worse than no test; it needs a properly scoped session of its own. | Partial (implemented, untested) |
| Complete lesson | Same file/mechanism as above (`upsertLessonProgress(..., 'completed')` presumably on quiz pass — not fully traced). | NOT YET AUDITED |
| Handle missing content | Implemented: invalid lesson slug → `navigate("/academy")` (silent redirect, no crash) at `AcademyLesson.tsx:406`; a load exception shows an explicit "Lesson not found" screen (`error` state, line 582). Minor UX gap noted but not fixed: the invalid-slug redirect is silent (no toast telling the user why they were redirected) whereas the exception path is explicit — inconsistent but not broken. Untested. | Partial (implemented, untested; minor UX inconsistency) |

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
