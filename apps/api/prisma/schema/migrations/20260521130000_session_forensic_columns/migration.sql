-- Phase 27 (2026-05-21) — session forensic + activity columns.
--
-- All 5 session tables gain:
--   • revoked_by         — admin (or self) who set revokedAt
--   • revocation_reason  — operator-supplied free-text reason
--
-- The 4 non-customer tables also gain (customer already had them
-- since Phase 17):
--   • last_used_at       — bumped on every refresh-rotate
--   • device_label       — UA-derived "Chrome on macOS" etc.
--
-- All nullable. Existing rows backfill to NULL — interpret as
-- "pre-Phase-27 session; revoker / reason / device not captured."

-- ── Customer (users / sessions) ──
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "revoked_by"        TEXT,
  ADD COLUMN IF NOT EXISTS "revocation_reason" TEXT;

-- ── Admin ──
ALTER TABLE "admin_sessions"
  ADD COLUMN IF NOT EXISTS "revoked_by"        TEXT,
  ADD COLUMN IF NOT EXISTS "revocation_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "last_used_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "device_label"      VARCHAR(64);

-- ── Seller ──
ALTER TABLE "seller_sessions"
  ADD COLUMN IF NOT EXISTS "revoked_by"        TEXT,
  ADD COLUMN IF NOT EXISTS "revocation_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "last_used_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "device_label"      VARCHAR(64);

-- ── Franchise ──
ALTER TABLE "franchise_sessions"
  ADD COLUMN IF NOT EXISTS "revoked_by"        TEXT,
  ADD COLUMN IF NOT EXISTS "revocation_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "last_used_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "device_label"      VARCHAR(64);

-- ── Affiliate ──
ALTER TABLE "affiliate_sessions"
  ADD COLUMN IF NOT EXISTS "revoked_by"        TEXT,
  ADD COLUMN IF NOT EXISTS "revocation_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "last_used_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "device_label"      VARCHAR(64);
