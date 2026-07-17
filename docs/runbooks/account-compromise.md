# Runbook: Suspected account compromise

**Rehearsed:** NO

- **Trigger:** user reports unrecognized activity; anomalous access pattern in audit log; impossible-travel style sign-in pattern in Supabase Auth logs.
- **Severity:** SEV-1 (admin account) / SEV-2 (single user account).
- **User impact:** affected account's chat history, profile, paper-trading data confidentiality/integrity.

## Immediate containment
1. **Suspend the account** via the admin lifecycle endpoint (audited, tested: `test_user_account_lifecycle.py`) — suspension blocks access while preserving data.
2. Admin account suspected → treat as SEV-1: suspend, then rotate any secrets an admin session could have observed, and review all recent admin audit events.
3. Revoke sessions: Supabase dashboard → Authentication → user → sign out all sessions.

## Diagnostics
- Audit trail: privileged operations by/on the account (`app/services/audit.py` stream).
- Supabase Auth logs: sign-in IPs, methods, timestamps for the account.
- Data-access review: what the account touched (chat, trades) within the window.

## Dashboards / logs
Supabase Auth logs, audit log, Sentry (unusual client errors can indicate credential-stuffing tooling).

## Recovery
1. Verify the real owner out-of-band (registered email).
2. Password reset + (if Google) advise provider-side security check.
3. Restore via the tested restore endpoint (email must match — `test_restore_rejects_email_mismatch`).
4. If credential-stuffing suspected across accounts: check rate-limit/abuse logs for the source pattern (`abuse-rate-limit.md`) and consider a forced reset for affected accounts only.

## Rollback
Not applicable; never delete evidence.

## Validation
Owner regains access; no further anomalous events for 72 h; audit trail of the incident complete.

## Communication
Direct, factual email to the affected user: what was seen, what was contained, what they should do. SEV-1 (admin): also assess whether other users' data was exposed — if yes, disclosure obligations apply (owner + legal placeholder in `OWNERSHIP.md`).

## Post-incident
Feed indicators into abuse thresholds; consider MFA support prioritization (currently not implemented — known limitation).
