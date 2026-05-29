-- Phase 27 (2026-05-21) — drop phone-verification scaffolding.
--
-- The platform does not gate any flow on phone verification today
-- (login, recovery, COD, and onboarding all use email). The columns
-- + the AffiliatePhoneVerificationOtp table were leftover half-built
-- schema: `users.phone_verified` was only ever written to FALSE on
-- profile-edit (never TRUE); `affiliates.phone_verified` /
-- `affiliates.phone_verified_at` had no writers; the
-- `affiliate_phone_verification_otps` table had zero INSERTs from
-- application code. Removing the misleading schema so future
-- engineers don't assume the feature exists.
--
-- The `phone` / `phone_number` columns on every actor are PRESERVED
-- — they remain as opaque contact data for delivery, support, etc.

-- 1. Affiliate phone-verify OTP table — drop wholesale (no readers).
DROP TABLE IF EXISTS "affiliate_phone_verification_otps";

-- 2. Affiliate phone-verification columns.
ALTER TABLE "affiliates"
  DROP COLUMN IF EXISTS "phone_verified",
  DROP COLUMN IF EXISTS "phone_verified_at";

-- 3. Customer (User) phone-verification columns.
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "phone_verified",
  DROP COLUMN IF EXISTS "phone_verified_at";
