-- Data-integrity verification queries for the Phase 5 recovery drill.
-- Run these against the ISOLATED restored project only — never production.
--
-- Status: NOT VERIFIED — these have not been run against a real restore.
-- They are read-only (SELECT/COUNT only); none of them mutate data.
--
-- Usage: run each numbered block, record the output in
-- RECOVERY_EVIDENCE_TEMPLATE.md, and compare row counts / spot-checked rows
-- against whatever pre-restore baseline you have (e.g. a table-count
-- snapshot taken from production shortly before the backup, if one exists —
-- if it doesn't, note that the comparison is "no baseline available" rather
-- than skipping the section silently).

-- ============================================================================
-- 1. Users (core.users, auth.users)
-- ============================================================================

-- Total user count — compare against a pre-restore baseline if available.
SELECT count(*) AS core_users_count FROM core.users;
SELECT count(*) AS auth_users_count FROM auth.users;

-- Every core.users row should have a matching auth.users row (the
-- handle_new_user trigger provisions core.users from auth.users, never the
-- reverse) — a mismatch here indicates a restore-order or FK problem.
SELECT count(*) AS orphaned_core_users
FROM core.users cu
LEFT JOIN auth.users au ON au.id = cu.auth_id
WHERE au.id IS NULL;
-- Expected: 0

-- Spot-check a handful of real (non-test) users exist with plausible data.
SELECT id, auth_id, email, "userType", account_status, created_at
FROM core.users
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- 2. Profiles (core.user_profiles, meridian.user_goals)
-- ============================================================================

SELECT count(*) AS user_profiles_count FROM core.user_profiles;
SELECT count(*) AS user_goals_count FROM meridian.user_goals;

-- Every user_profiles row should reference a real auth.users row.
SELECT count(*) AS orphaned_user_profiles
FROM core.user_profiles up
LEFT JOIN auth.users au ON au.id = up.user_id
WHERE au.id IS NULL;
-- Expected: 0

-- ============================================================================
-- 3. Chats (ai.chats, ai.chat_messages, ai.chat_turn_requests)
-- ============================================================================

SELECT count(*) AS chats_count FROM ai.chats;
SELECT count(*) AS chat_messages_count FROM ai.chat_messages;

-- Every chat_messages row should reference a real chat.
SELECT count(*) AS orphaned_chat_messages
FROM ai.chat_messages cm
LEFT JOIN ai.chats c ON c.id = cm.chat_id
WHERE c.id IS NULL;
-- Expected: 0

-- Message ordering sanity: no chat should have messages with duplicate
-- (chat_id, created_at) in a way that suggests corruption (exact ties are
-- possible but a large cluster is suspicious).
SELECT chat_id, created_at, count(*) AS dup_count
FROM ai.chat_messages
GROUP BY chat_id, created_at
HAVING count(*) > 1
ORDER BY dup_count DESC
LIMIT 20;

-- Turn requests left in a non-terminal state after restore (should be
-- resolved by chat_turn_reconciliation, not simply absent from this check).
SELECT status, count(*)
FROM ai.chat_turn_requests
GROUP BY status;

-- ============================================================================
-- 4. Paper trades (trading.trade_journal, trading.open_positions,
--    trading.trades, trading.portfolio_history)
-- ============================================================================

SELECT count(*) AS trade_journal_count FROM trading.trade_journal;
SELECT count(*) AS open_positions_count FROM trading.open_positions;
SELECT count(*) AS trades_count FROM trading.trades;
SELECT count(*) AS portfolio_history_count FROM trading.portfolio_history;

-- Positive-value constraints should already be enforced by DB constraints
-- (see backend/websearch_service/alembic/versions/0034_trading_positive_constraints.py)
-- but verify no row somehow violates them post-restore (e.g. if the backup
-- predates that migration and something restored inconsistent data):
SELECT count(*) AS non_positive_journal_rows
FROM trading.trade_journal
WHERE quantity <= 0 OR price <= 0;
-- Expected: 0

SELECT count(*) AS non_positive_position_rows
FROM trading.open_positions
WHERE quantity <= 0 OR entry_price <= 0;
-- Expected: 0

-- Oversell check: for every (user, symbol), cumulative BUY quantity must be
-- >= cumulative SELL quantity, matching the oversell-protection invariant
-- tested in test_trading_constraints_db.py.
SELECT user_id, symbol,
       sum(CASE WHEN type = 'BUY' THEN quantity ELSE -quantity END) AS net_quantity
FROM trading.trade_journal
GROUP BY user_id, symbol
HAVING sum(CASE WHEN type = 'BUY' THEN quantity ELSE -quantity END) < 0;
-- Expected: zero rows returned. Any row here is a serious integrity failure —
-- it means a position went negative, which the oversell-protection trigger
-- should have made impossible during normal operation.

-- ============================================================================
-- 5. Academy progress (academy.user_lesson_progress, academy.quiz_attempts,
--    academy.tier_enrollments)
-- ============================================================================

SELECT count(*) AS lesson_progress_count FROM academy.user_lesson_progress;
SELECT count(*) AS quiz_attempts_count FROM academy.quiz_attempts;

SELECT status, count(*)
FROM academy.user_lesson_progress
GROUP BY status;

-- Every progress row should reference a real user and a real lesson.
SELECT count(*) AS orphaned_progress_rows
FROM academy.user_lesson_progress ulp
LEFT JOIN auth.users au ON au.id = ulp.user_id
WHERE au.id IS NULL;
-- Expected: 0

-- ============================================================================
-- 6. Audit records
-- ============================================================================

-- The application audit log (app/services/audit.py) writes to a JSONL file
-- on the running instance's filesystem, NOT a database table — it will not
-- be present in the restored database at all. This is itself a finding of
-- MONITORING_IMPLEMENTATION_PLAN.md (the audit log's durability gap): a
-- database restore alone cannot recover the audit trail as currently
-- implemented. Verify audit evidence separately, from wherever the audit
-- log file(s) were archived (if anywhere) — do not report "audit records
-- verified" based on this SQL file alone.

-- What CAN be verified in the database: admin job history, which overlaps
-- with (but is not the same as) the audit trail.
SELECT job_type, status, count(*)
FROM core.admin_jobs
GROUP BY job_type, status
ORDER BY job_type, status;
-- (Table/schema name to confirm at drill time against the actual current
-- migration history — admin job logging has evolved across revisions
-- 0031/0032; verify the exact table name against
-- backend/websearch_service/alembic/versions/ at the SHA you're restoring.)

-- ============================================================================
-- Summary
-- ============================================================================
-- Every "Expected: 0" query above returning a non-zero count is a data-
-- integrity finding, not a warning to note and move past. Record every
-- query's actual output (not just pass/fail) in RECOVERY_EVIDENCE_TEMPLATE.md.
