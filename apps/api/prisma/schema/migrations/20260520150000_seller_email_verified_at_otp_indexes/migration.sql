-- Phase 18 (2026-05-20) — Seller registration + email verification
-- flow hardening, audit follow-up.
--
-- Two changes:
--
--   1. Seller gains email_verified_at (DateTime?) — compliance audit
--      needs the precise verification timestamp, not just the boolean
--      `is_email_verified`. The verify-email transaction now stamps
--      it inside the same tx that flips the boolean to true.
--
--      Backfill: rows that already have is_email_verified=true (legacy
--      pre-Phase-18 sellers) get email_verified_at = updated_at as the
--      best-available approximation. New verifications going forward
--      land a precise timestamp.
--
--   2. seller_password_reset_otps gains two coverage indexes:
--      (seller_id, purpose) — every OTP lookup filters on both.
--      (expires_at)         — the expiry-sweep cron queries on this.
--
-- Rollback: drop the column + drop the two indexes.

-- 1) Seller.email_verified_at -----------------------------------------
ALTER TABLE "sellers"
    ADD COLUMN "email_verified_at" TIMESTAMP(3);

UPDATE "sellers"
SET "email_verified_at" = "updated_at"
WHERE "is_email_verified" = TRUE AND "email_verified_at" IS NULL;

-- 2) OTP coverage indexes ---------------------------------------------
CREATE INDEX "seller_password_reset_otps_seller_id_purpose_idx"
    ON "seller_password_reset_otps" ("seller_id", "purpose");

CREATE INDEX "seller_password_reset_otps_expires_at_idx"
    ON "seller_password_reset_otps" ("expires_at");
