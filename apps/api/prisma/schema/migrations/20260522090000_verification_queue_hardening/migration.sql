-- Phase 68 (2026-05-22) — Order Verification Queue hardening.
-- Closes audit gaps #9 (verifier FK), #10 (claim-holder FK), and
-- #13 (real verification SLA deadline).

-- ── MasterOrder.verificationDeadlineAt ──────────────────────────
-- Audit Gap #13 — pre-Phase-68 the queue-stats "breached SLA" count
-- was a 1-hour proxy on created_at because no deadline column
-- existed. The place-order service stamps NOW() + 1h for COD; the
-- payment-verified path stamps it on ONLINE flip-to-PLACED. The
-- breach detector cron + queue-stats banner read this column
-- directly going forward.
ALTER TABLE "master_orders"
  ADD COLUMN IF NOT EXISTS "verification_deadline_at" TIMESTAMP;

-- Backfill: every existing PLACED order gets created_at + 1h so the
-- live queue isn't suddenly "no deadline anywhere."
UPDATE "master_orders"
SET    "verification_deadline_at" = "created_at" + INTERVAL '1 hour'
WHERE  "order_status" = 'PLACED'::"OrderStatus"
  AND  "verification_deadline_at" IS NULL;

-- Composite index backing the breach-detector cron + queue-stats:
--   WHERE order_status = 'PLACED' AND verification_deadline_at < NOW()
CREATE INDEX IF NOT EXISTS "master_orders_order_status_verification_deadline_idx"
  ON "master_orders" ("order_status", "verification_deadline_at");

-- ── Verifier / claim-holder FK relations ────────────────────────
-- Audit Gaps #9 + #10 — pre-Phase-68 verifiedBy and
-- claimedByAdminId were bare strings; admin deletion silently
-- orphaned the columns. Both relations are SET NULL on admin
-- delete so the order survives and the admin identity is dropped.
--
-- The NOT VALID clause skips the immediate row-by-row check (which
-- would block on any pre-existing orphan reference). The follow-up
-- VALIDATE runs the check in the background; existing orphans
-- must first be cleaned up by setting the stale id to NULL.
UPDATE "master_orders" SET "verified_by" = NULL
WHERE  "verified_by" IS NOT NULL
  AND  "verified_by" NOT IN (SELECT "id" FROM "admins");

UPDATE "master_orders" SET "claimed_by_admin_id" = NULL
WHERE  "claimed_by_admin_id" IS NOT NULL
  AND  "claimed_by_admin_id" NOT IN (SELECT "id" FROM "admins");

ALTER TABLE "master_orders"
  ADD CONSTRAINT "master_orders_verified_by_fkey"
  FOREIGN KEY ("verified_by") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "master_orders"
  ADD CONSTRAINT "master_orders_claimed_by_admin_id_fkey"
  FOREIGN KEY ("claimed_by_admin_id") REFERENCES "admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
