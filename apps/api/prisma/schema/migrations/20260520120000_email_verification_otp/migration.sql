-- Phase 16 (2026-05-20) — Customer registration email-verification flow.
--
-- Before this migration, customer registration created a User with
-- emailVerified=false but never had any way to flip it to true: there
-- was no OTP storage, no verify endpoint, no event subscriber, and no
-- UI page. Any signup with any email worked, and the user could log in
-- immediately. The `identity.user.registered` domain event was emitted
-- but had zero subscribers.
--
-- This migration introduces the missing pieces on the database side:
--
--   1. UserStatus gains a new value PENDING_VERIFICATION. New
--      registrations land in this state and stay there until OTP
--      verification flips them to ACTIVE. LoginUserUseCase will refuse
--      to issue tokens for users in PENDING_VERIFICATION.
--
--   2. Users gain emailVerifiedAt / phoneVerifiedAt / lastLoginAt
--      timestamps. The existing booleans answer "is this verified
--      now?" but DPDP audit and inactive-account sweeps both need
--      "exactly when." Nullable so legacy rows are unchanged.
--
--   3. A new table email_verification_otps mirrors password_reset_otps:
--      SHA-256 hashed OTP, attempts counter, max-attempts cap (5),
--      expiresAt (10-min TTL), verifiedAt. The verify use-case uses an
--      atomic CAS increment (parity with verify-reset-otp).
--
-- Rollback: drop the table, drop the new columns. The enum value
-- cannot be dropped cleanly in Postgres without a multi-step migration
-- (rename type, recreate without value, swap) so a rollback would have
-- to first update any rows with status='PENDING_VERIFICATION' back to
-- 'INACTIVE' before dropping the enum value.

-- 1) UserStatus: add PENDING_VERIFICATION ----------------------------
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION';

-- 2) User: verification + login timestamps ---------------------------
ALTER TABLE "users"
    ADD COLUMN "email_verified_at" TIMESTAMP(3),
    ADD COLUMN "phone_verified_at" TIMESTAMP(3),
    ADD COLUMN "last_login_at"     TIMESTAMP(3);

-- Backfill: existing accounts with emailVerified=true (none exist
-- today because no flow ever set it, but defensive) get an
-- emailVerifiedAt = updated_at as the best-available approximation.
-- Newly verified accounts going forward write a precise timestamp.
UPDATE "users"
SET "email_verified_at" = "updated_at"
WHERE "email_verified" = TRUE AND "email_verified_at" IS NULL;

UPDATE "users"
SET "phone_verified_at" = "updated_at"
WHERE "phone_verified" = TRUE AND "phone_verified_at" IS NULL;

-- 3) email_verification_otps -----------------------------------------
CREATE TABLE "email_verification_otps" (
    "id"           TEXT NOT NULL,
    "user_id"      TEXT NOT NULL,
    "otp_hash"     TEXT NOT NULL,
    "attempts"     INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at"   TIMESTAMP(3) NOT NULL,
    "verified_at"  TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_verification_otps_user_id_idx"
    ON "email_verification_otps" ("user_id");

CREATE INDEX "email_verification_otps_expires_at_idx"
    ON "email_verification_otps" ("expires_at");

ALTER TABLE "email_verification_otps"
    ADD CONSTRAINT "email_verification_otps_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
