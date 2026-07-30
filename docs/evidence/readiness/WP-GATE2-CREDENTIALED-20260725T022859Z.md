# Evidence — WP-GATE2-CREDENTIALED: Gate 2 staging authentication/authorization proof — credentialed continuation of WP-GATE2. Staging secrets (SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, SUPABASE_ANON_KEY, SUPABASE_URL) were supplied directly by the operator after sandbox-level extraction attempts were denied. Four disposable staging-only accounts were created via the Supabase Admin API (userA, userB, admin, and a throwaway used only for the destructive delete-lifecycle path) and used to drive the full credentialed test matrix live against main-staging.

- **Run ID:** `WP-GATE2-CREDENTIALED-20260725T022859Z`
- **Result:** **FAIL**
- **Environment:** staging  ·  **App version:** 0.1.0
- **Commit:** `e89baf1aebb03558906fd711983f1ca0a899f0ce`
- **Started:** 2026-07-25T02:28:59Z  ·  **Finished:** 2026-07-25T02:28:59Z
- **Command:** `Password grant sign-in/refresh/logout via Supabase Auth REST (apikey=anon); backend calls to /api/v1/ai/context, /api/v1/trades/orders, /api/chat, /api/meridian/refresh-context, /api/admin/system-health, /api/admin/users/{id}/suspend|delete-request|delete-execute with real bearer tokens; PyJWT-crafted tokens signed with the real staging SUPABASE_JWT_SECRET for expired/wrong-issuer/missing-claim/anon-role isolation tests; direct PostgREST calls to /rest/v1/chats (Accept-Profile: ai) with real user JWTs for IDOR; POST /api/v1/ws/ticket + wss://.../ws/live via python `websockets`.`
- **Content SHA-256:** `6819059a52f65120e2552a41f32411fecbafd752477169804be59903a0a7ffe1`

## Preconditions
- Staging secrets supplied directly by the operator via chat after two sandbox-level denials of automated extraction (see WP-GATE2 for that history); written only to a local gitignored scratch file, never echoed back after receipt.
- 4 disposable accounts created via Admin API with confirmed emails: userA, userB, admin (promoted to core.users.userType='Admin' via a single service-role PATCH), and a throwaway 4th account created solely to exercise the destructive suspend/delete lifecycle path without touching userA/userB/admin, which are left intact for reuse. The throwaway was hard-deleted via the Admin API at the end of this run after the app-level lifecycle path proved blocked (see findings).
- Deployed staging commit unchanged from WP-GATE2: 5532d52a40d3fa05854eef963579d4e85f03fd17 (== 12551ea for backend purposes, docs-only diff).

## Assertions
- Real password sign-in succeeds for all 4 accounts: issuer == staging Supabase project (edmskamnzcqswxayuqgd), role == authenticated, expiry ~3600s. Session refresh, local sign-out (204), and re-sign-in all succeed. (API-level equivalent of the frontend flow — no browser automation tool was available in this session.)
- Backend accepts the real userA JWT on GET /api/v1/ai/context (200), POST /api/v1/trades/orders (422 validation error, not 401 — token was verified), and POST /api/chat (502 upstream error, not 401 — token was verified).
- /api/meridian/refresh-context rejects (403) userB submitting userA's id in the request body, and accepts (200) userB submitting their own id — confirms the endpoint never trusts a client-supplied user id.
- Tokens signed with the REAL staging JWT secret are correctly rejected (401) when expired, when missing the 'role' claim, or when missing the 'sub' claim.
- A staging-signed token bearing the PRODUCTION project's issuer claim is rejected (401) — proxy for cross-environment issuer isolation; NOT a real production-signed token (out of scope per operator decision).
- CONFIRMED LIVE VULNERABILITY (HIGH): a validly-signed (real staging secret) JWT with role='anon' is ACCEPTED (HTTP 200) by require_auth on GET /api/v1/ai/context. Gate 2 section 3 explicitly requires this be rejected. require_auth checks claim PRESENCE (sub, exp, iat, role) but never validates the role claim's VALUE — only verify_service_role and the admin path's core.users lookup check role/userType values. The admin route correctly still rejects the same anon-role token (403) via its separate DB-lookup path, so the live exposure is scoped to endpoints that rely on require_auth alone.
- Chat resource IDOR (RLS-backed): userA creates a chat; userB's GET returns 0 rows, userB's PATCH affects 0 rows, userB's DELETE affects 0 rows (returned HTTP 404 rather than 200/empty — a PostgREST response-shape detail, not a security gap); a follow-up GET as userA confirms the chat survived fully intact. RLS is doing its job here.
- Admin route authorization: userA and userB both get 403 on /api/admin/system-health; the promoted admin account gets 200; a forged JWT with fabricated 'user_role':'admin' / app_metadata.userType='Admin' claims still gets 403 — confirms admin identity is resolved from the server-side core.users lookup, never from client-supplied JWT claims.
- WebSocket ticket flow fully confirmed live: ticket issuance requires auth; first use connects and exchanges a message; reuse of the same ticket is rejected (close/handshake 403); a garbage ticket is rejected (403); connecting with an unapproved Origin is rejected (403) even with a valid ticket.
- Section 7 (disable/delete lifecycle) could NOT be completed: the admin suspend endpoint returned 503 with detail 'audit trail could not be durably persisted; refusing to proceed with this destructive operation until audit logging is restored'. Root-caused to AUDIT_PSEUDONYM_PEPPER not being set in staging's Railway environment (app/services/audit.py: pseudonymize() requires this pepper outside development/test, audit_log(..., mandatory=True) raises rather than proceed without it). This is the fail-closed safety control working exactly as designed — not a security exposure — but it means no admin lifecycle operation (suspend, delete, restore) can succeed on staging today, so the revocation-timing question (does a pre-issued, unexpired access JWT keep working after suspend?) remains unverified live.

## Metrics

| Metric | Value |
| --- | --- |
| credentialed_checks_total | 42 |
| credentialed_checks_passed | 36 |
| credentialed_checks_failed | 6 |
| password_auth_flow | pass (sign-in, refresh, logout, re-sign-in) |
| backend_jwt_acceptance | pass (read, write, chat) |
| client_supplied_user_id_trusted | false (pass — meridian rejects spoof) |
| expired_token_valid_sig | 401 (pass) |
| wrong_issuer_token_valid_sig | 401 (pass, synthetic issuer only) |
| missing_role_claim_valid_sig | 401 (pass) |
| missing_sub_claim_valid_sig | 401 (pass) |
| anon_role_token_valid_sig_vs_require_auth | 200 ACCEPTED (FAIL -- HIGH finding) |
| anon_role_token_valid_sig_vs_admin_route | 403 (pass) |
| idor_chat_read | blocked, 0 rows (pass) |
| idor_chat_update | blocked, 0 rows affected (pass) |
| idor_chat_delete | blocked, target survived intact (pass; HTTP code itself was 404 not 200/204) |
| admin_route_userA | 403 (pass) |
| admin_route_userB | 403 (pass) |
| admin_route_admin | 200 (pass) |
| admin_route_forged_role_claim | 403 (pass) |
| ws_ticket_single_use | pass |
| ws_ticket_garbage_rejected | pass |
| ws_unapproved_origin_rejected | pass |
| section_7_disable_delete_lifecycle | BLOCKED -- staging missing AUDIT_PSEUDONYM_PEPPER (fails closed, safe) |

## Failure details
One new HIGH-severity live-confirmed defect: require_auth accepts a validly-signed role='anon' JWT (HTTP 200 on a real protected read endpoint), violating Gate 2's explicit acceptance criterion that an anonymous-role token must be rejected where an authenticated role is required. Combined with the unresolved Academy-RPC IDOR finding from WP-GATE2, Gate 2 has two unresolved HIGH authorization findings, so per its own acceptance criteria (section 12) it cannot pass. Section 7 additionally could not be verified end-to-end due to a staging environment configuration gap (missing AUDIT_PSEUDONYM_PEPPER), which is a blocker for gate completion even though the underlying control behavior (fail closed) is correct.

## Artifacts
- `docs/evidence/readiness/WP-GATE2-20260725T015806Z.{json,md} (prior phase)`
- `docs/evidence/readiness/ (this record)`

## Remaining risks
- HIGH (NEW, this phase): require_auth does not validate the JWT 'role' claim value, only its presence. Fix: require role == 'authenticated' (reject anon/service_role/other) in require_auth, mirroring the value-check verify_service_role already does.
- HIGH (carried over from WP-GATE2, still unresolved): 5 SECURITY DEFINER Academy RPCs accept an unauthenticated caller-supplied p_user_id.
- MEDIUM: AUDIT_PSEUDONYM_PEPPER missing from staging's Railway main-staging environment blocks all admin suspend/delete/restore operations (fails closed -- safe, but gate-blocking). Add the env var and re-run section 7.
- Once AUDIT_PSEUDONYM_PEPPER is set, re-verify the specific revocation-timing question: does a pre-issued, unexpired access JWT for a just-suspended user still pass require_auth's local (non-REST) verification path until natural expiry? Code reading in WP-GATE2 suggested yes; this phase could not confirm it live because suspend itself never succeeded.
- Section 4's environment-isolation proof remains synthetic only (staging-signed token with a foreign issuer claim, not a real production-signed token) per the operator's explicit scope decision.
- Section 10 (auth-provider failure simulation) remains code-review only, per the operator's explicit scope decision.

## Reviewer notes
userA, userB, and the promoted admin account are left active in staging (not deleted) so they can be reused for a follow-up run once the two HIGH findings are fixed and AUDIT_PSEUDONYM_PEPPER is set -- at that point section 7 can finally be exercised on these same identities. The throwaway 4th account used for the blocked suspend/delete attempt was hard-deleted via the Admin API as cleanup since the app-level lifecycle path could not complete. No passwords, refresh tokens, or raw JWTs are recorded anywhere in this evidence or in chat output after the operator's initial paste of the four long-lived secrets, which were written directly to a local, session-scoped, gitignored file and never re-displayed.
