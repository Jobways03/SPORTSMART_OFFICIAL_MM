-- Phase 207 / 208 — Access-log brute-force + admin-activity hardening.
--
-- 1. New AccessEventKind values for 2FA / reset-OTP verify outcomes so
--    the brute-force spike detectors can SEE MFA/OTP guessing (#207-3).
--    ALTER TYPE ... ADD VALUE is non-transactional in PostgreSQL; Prisma
--    applies migration statements one-by-one (same pattern as the Phase
--    201 migration 20260602370000), so this is safe. IF NOT EXISTS makes
--    it idempotent. None of these new values are USED (no INSERT/UPDATE
--    referencing them) in this migration, so the "can't use a new enum
--    value in the same tx" rule is also satisfied.
ALTER TYPE "AccessEventKind" ADD VALUE IF NOT EXISTS 'MFA_VERIFY_SUCCESS';
ALTER TYPE "AccessEventKind" ADD VALUE IF NOT EXISTS 'MFA_VERIFY_FAILED';
ALTER TYPE "AccessEventKind" ADD VALUE IF NOT EXISTS 'OTP_VERIFY_SUCCESS';
ALTER TYPE "AccessEventKind" ADD VALUE IF NOT EXISTS 'OTP_VERIFY_FAILED';

-- 2. Correlation id on access_logs (#207-16 / #208-12). Nullable, no
--    backfill needed (old rows simply have no request id).
ALTER TABLE "access_logs" ADD COLUMN IF NOT EXISTS "request_id" TEXT;

CREATE INDEX IF NOT EXISTS "access_logs_request_id_idx"
  ON "access_logs" ("request_id");

-- Composite index backing the brute-force spike GROUP BY scans
-- (#207-2 / #207-6). The detectors filter kind='LOGIN_FAILURE' over a
-- recent createdAt window and group by ipAddress / actorId; this makes
-- those scans index-only on the fastest-growing table.
CREATE INDEX IF NOT EXISTS "access_logs_kind_created_at_ip_address_idx"
  ON "access_logs" ("kind", "created_at", "ip_address");

-- 3. Snapshot the acting admin's role on admin_action_audit_logs at
--    write time (#208-4). Nullable; pre-existing rows stay NULL and the
--    timeline falls back to the prior (filter-derived) behaviour for
--    those, while new rows carry the truthful role.
ALTER TABLE "admin_action_audit_logs"
  ADD COLUMN IF NOT EXISTS "actor_role" TEXT;

-- NOTE (#207-2): the BruteForceSpikeCron opens an AdminTask using the
-- existing AdminTaskKind='OTHER' + sourceType='MANUAL' so this migration
-- does NOT touch the AdminTaskKind enum (owned by liability-ledger.prisma,
-- a concurrently-edited file). A dedicated SECURITY_BRUTE_FORCE_DETECTED
-- kind is the cleaner long-term home and is SURFACED for the owning agent.
