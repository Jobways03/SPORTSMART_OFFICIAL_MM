-- Phase 20 (2026-05-20) — Franchise onboarding hardening.
--
-- Six logical changes:
--
--   1. gstNumber + panNumber @unique on FranchisePartner. Pre-Phase-20
--      two franchises could claim the same legal identity.
--
--   2. KYC submission columns:
--        gst_state_code, pan_last_4
--        kyc_submitted_at, kyc_submitted_payload_json
--        kyc_confirmed_accurate_at
--
--   3. Verification-review audit columns:
--        verification_reviewed_at, verification_reviewed_by
--        verification_rejection_reason, verification_approval_notes
--
--   4. Approval-action audit columns:
--        approved_at, approved_by, activated_at, activated_by
--
--   5. email_verified_at timestamp (boolean isEmailVerified already
--      exists).
--
--   6. franchise_bank_details table (1:1 with FranchisePartner).
--
-- Pre-migration safety: if duplicates exist on gstNumber/panNumber,
-- the unique-index creation fails. Operators must clean up first.
-- See:
--   SELECT gst_number, COUNT(*) FROM franchise_partners
--   WHERE gst_number IS NOT NULL GROUP BY gst_number HAVING COUNT(*) > 1;
--   SELECT pan_number, COUNT(*) FROM franchise_partners
--   WHERE pan_number IS NOT NULL GROUP BY pan_number HAVING COUNT(*) > 1;

-- 1) New columns on franchise_partners ------------------------------
ALTER TABLE "franchise_partners"
    ADD COLUMN "gst_state_code"                 TEXT,
    ADD COLUMN "pan_last_4"                     TEXT,
    ADD COLUMN "kyc_submitted_at"               TIMESTAMP(3),
    ADD COLUMN "kyc_submitted_payload_json"     JSONB,
    ADD COLUMN "kyc_confirmed_accurate_at"      TIMESTAMP(3),
    ADD COLUMN "verification_reviewed_at"       TIMESTAMP(3),
    ADD COLUMN "verification_reviewed_by"       TEXT,
    ADD COLUMN "verification_rejection_reason"  TEXT,
    ADD COLUMN "verification_approval_notes"    TEXT,
    ADD COLUMN "approved_at"                    TIMESTAMP(3),
    ADD COLUMN "approved_by"                    TEXT,
    ADD COLUMN "activated_at"                   TIMESTAMP(3),
    ADD COLUMN "activated_by"                   TEXT,
    ADD COLUMN "email_verified_at"              TIMESTAMP(3);

-- Backfill email_verified_at for any pre-existing isEmailVerified=true
-- franchises (none exist today because no flow ever flipped the flag,
-- but defensive).
UPDATE "franchise_partners"
SET "email_verified_at" = "updated_at"
WHERE "is_email_verified" = TRUE AND "email_verified_at" IS NULL;

-- 2) Unique constraints (NULL-friendly under Postgres) ---------------
CREATE UNIQUE INDEX "franchise_partners_gst_number_key"
    ON "franchise_partners" ("gst_number");
CREATE UNIQUE INDEX "franchise_partners_pan_number_key"
    ON "franchise_partners" ("pan_number");

-- 3) OTP coverage indexes -------------------------------------------
CREATE INDEX "franchise_password_reset_otps_franchise_partner_id_purpose_idx"
    ON "franchise_password_reset_otps" ("franchise_partner_id", "purpose");
CREATE INDEX "franchise_password_reset_otps_expires_at_idx"
    ON "franchise_password_reset_otps" ("expires_at");

-- 4) Session coverage indexes ---------------------------------------
CREATE INDEX "franchise_sessions_franchise_partner_id_revoked_at_idx"
    ON "franchise_sessions" ("franchise_partner_id", "revoked_at");
CREATE INDEX "franchise_sessions_franchise_partner_id_expires_at_idx"
    ON "franchise_sessions" ("franchise_partner_id", "expires_at");

-- 5) franchise_bank_details -----------------------------------------
CREATE TABLE "franchise_bank_details" (
    "id"                    TEXT NOT NULL,
    "franchise_partner_id"  TEXT NOT NULL,
    "account_holder_name"   VARCHAR(150) NOT NULL,
    "account_number_enc"    TEXT NOT NULL,
    "account_number_last_4" VARCHAR(4)   NOT NULL,
    "ifsc_code"             VARCHAR(11)  NOT NULL,
    "bank_name"             VARCHAR(150),
    "upi_vpa"               VARCHAR(100),
    "verified_at"           TIMESTAMP(3),
    "verified_by"           TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "franchise_bank_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "franchise_bank_details_franchise_partner_id_key"
    ON "franchise_bank_details" ("franchise_partner_id");

ALTER TABLE "franchise_bank_details"
    ADD CONSTRAINT "franchise_bank_details_franchise_partner_id_fkey"
    FOREIGN KEY ("franchise_partner_id") REFERENCES "franchise_partners"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
