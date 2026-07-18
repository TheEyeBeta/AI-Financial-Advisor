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
- Audit trail: privileged operations by/on the account, durably recorded in
  `core.audit_events` (see `docs/security/AUDIT_TRAIL.md`). Pseudonymization
  is an **application-level** HMAC helper (`app/services/audit.py:pseudonymize`)
  keyed by the server-side `AUDIT_PSEUDONYM_PEPPER` secret — it is not a SQL
  function, and the pepper must never be typed into a SQL client. From a
  backend shell with that env var available, compute the pseudonym first,
  then query by its output:
  ```bash
  cd backend/websearch_service
  python -c "from app.services.audit import pseudonymize; print(pseudonymize('<auth_id>'))"
  ```
  ```sql
  -- using the printed value, as the service role:
  SELECT * FROM core.audit_events
  WHERE target_pseudonymous_id = '<printed_value>'
  ORDER BY created_at DESC;
  ```
  Identifiers in the table are pseudonymized, not raw emails — correlate by
  auth id, not by looking up an email string.
- Supabase Auth logs: sign-in IPs, methods, timestamps for the account.
- Data-access review: what the account touched (chat, trades) within the window.

## Dashboards / logs
Supabase Auth logs, `core.audit_events`, Sentry (unusual client errors can indicate credential-stuffing tooling).

## Recovery
1. Verify the real owner before restoring — the registered email alone is
   **not** sufficient proof (if the mailbox is what was compromised, an
   email check hands the account back to the attacker). Require a second
   independent signal — e.g. Google-account sign-in for OAuth users, a
   detail only the owner would know from pre-incident history (signup date,
   early activity they can describe), or a live conversation — or route the
   case to explicit owner manual review and record the decision in the
   incident issue.
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
