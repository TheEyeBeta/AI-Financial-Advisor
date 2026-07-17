# Runbook: Suspected key leakage

**Rehearsed:** NO

- **Trigger:** gitleaks alert; key seen in a log/paste/screenshot; anomalous provider usage; GitHub secret-scanning notification.
- **Severity:** SEV-1 (service-role key, JWT secret, provider keys with spend) / SEV-2 (DSNs, staging-only tokens).
- **User impact:** potential full data exposure (service-role) or financial abuse (provider keys).

## Immediate containment — rotate first, investigate second
1. Identify the key class and go straight to its section in `docs/security/KEY_ROTATION.md`. For actively-exploited keys, revoke-first is correct even though it causes an outage.
2. Service-role key or JWT secret → assume RLS bypass was possible: after rotation, begin data-access review (Supabase logs for the exposure window).
3. Provider key (OpenAI etc.) → revoke, set/verify provider budget cap, check usage dashboard for the abuse window (feeds `cost-spike.md`).

## Diagnostics
- Exposure window: when did the key first appear where it shouldn't? (git history: `git log -S '<fragment>'`; CI logs; chat/paste source.)
- gitleaks full-history scan: `docs/security/SECRET_SCANNING.md` procedure.
- Provider usage dashboards for anomalous consumption in the window.

## Dashboards / logs
GitHub secret-scanning alerts, gitleaks CI job, Supabase logs, provider usage dashboards.

## Recovery
1. Rotation per runbook, verification per key class (readiness green, sign-in works, chat turn works).
2. If the key was committed: rotate regardless of "it was only a minute" — then purge from history only if the repo is private and history rewrite is coordinated; the rotation is the real control, not the purge.
3. Data-access review conclusion recorded in the incident issue: evidence of access / no evidence found (say which).

## Rollback
Not applicable.

## Validation
Old key rejected (test a call with it where safe); new key serving; scanners clean.

## Communication
SEV-1 with confirmed data access → user disclosure per `account-compromise.md` standards. Internal record regardless.

## Post-incident
Root-cause the leak path (tooling? doc? log?); add a gitleaks rule or redaction if a new pattern; update `KEY_ROTATION.md` cadence table with the unscheduled rotation date.
