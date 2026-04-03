-- Migration: add missing columns and UPDATE RLS policy for intelligence_digests
--
-- The alembic CREATE TABLE for meridian.intelligence_digests was missing the
-- headline, body, and is_read columns used by the intelligence engine and the
-- frontend markDigestRead function.  This migration adds them idempotently and
-- creates the UPDATE policy that allows users to mark their own digests read.
--
-- Run this in the Supabase SQL Editor once.

-- 1. Add columns that the TypeScript types expect (safe to re-run).
ALTER TABLE meridian.intelligence_digests
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS body     TEXT,
  ADD COLUMN IF NOT EXISTS is_read  BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Allow users to update only the is_read flag on their own rows.
--    The WITH CHECK prevents clients from reassigning the row to a different user.
DROP POLICY IF EXISTS "Users can mark own intelligence digests as read"
  ON meridian.intelligence_digests;

CREATE POLICY "Users can mark own intelligence digests as read"
  ON meridian.intelligence_digests FOR UPDATE
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
