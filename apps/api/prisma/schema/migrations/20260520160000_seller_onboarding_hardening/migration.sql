-- Phase 19 (2026-05-20) — Seller onboarding hardening.
--
-- Five logical changes:
--
--   1. GSTIN @unique + PAN @unique on the Seller table. Pre-Phase-19
--      two sellers could claim the same legal identity; only admin
--      review would catch the duplicate.
--
--   2. Five new admin-review audit columns:
--        kyc_approval_notes        — admin notes on approve
--        kyc_rejection_reason      — admin reason on reject
--        kyc_reviewed_at           — when the most-recent review landed
--        kyc_reviewed_by           — admin who decided
--        kyc_confirmed_accurate_at — when the seller ticked consent
--
--   3. is_gstin_manually_verified — split from is_gst_verified. The
--      old flag was auto-flipped on admin approve, which falsely
--      implied a GSTN-portal verification. The new flag is reserved
--      for an explicit verify-gstin admin action; approve no longer
--      touches it.
--
--   4. New seller_bank_details table. Account number AES-256
--      encrypted, last-4 stored separately for masked display.
--
-- Rollback: drop the new columns, drop the unique constraints, drop
-- the new table. Existing duplicate GSTIN/PAN rows would block the
-- @unique additions — see the pre-migration check comment below.

-- 1) Pre-migration safety check ----------------------------------------
-- If duplicates exist, the unique constraint creation will fail with
-- a clear error. Ops must clean up before re-running. We do NOT
-- silently merge or null-out duplicates from a migration — that's a
-- finance/compliance call, not a schema one.
--
-- To find duplicates pre-migration:
--   SELECT gstin, COUNT(*) FROM sellers
--   WHERE gstin IS NOT NULL GROUP BY gstin HAVING COUNT(*) > 1;
--   SELECT pan_number, COUNT(*) FROM sellers
--   WHERE pan_number IS NOT NULL GROUP BY pan_number HAVING COUNT(*) > 1;

-- 2) Seller: new KYC review audit columns -----------------------------
ALTER TABLE "sellers"
    ADD COLUMN "kyc_approval_notes"          TEXT,
    ADD COLUMN "kyc_rejection_reason"        TEXT,
    ADD COLUMN "kyc_reviewed_at"             TIMESTAMP(3),
    ADD COLUMN "kyc_reviewed_by"             TEXT,
    ADD COLUMN "kyc_confirmed_accurate_at"   TIMESTAMP(3),
    ADD COLUMN "is_gstin_manually_verified"  BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Backfill from legacy gst_verification_notes when it carried a
--    rejection reason. We can't perfectly distinguish approve vs
--    reject notes from the existing column; copy to BOTH new columns
--    for inspection. Operators can null one or the other based on
--    the row's current verification_status:
--      VERIFIED  → kyc_approval_notes (real)
--      REJECTED  → kyc_rejection_reason (real)
UPDATE "sellers"
SET "kyc_approval_notes"   = "gst_verification_notes"
WHERE "verification_status" = 'VERIFIED' AND "gst_verification_notes" IS NOT NULL;

UPDATE "sellers"
SET "kyc_rejection_reason" = "gst_verification_notes"
WHERE "verification_status" = 'REJECTED' AND "gst_verification_notes" IS NOT NULL;

-- 4) GSTIN + PAN uniqueness. Postgres treats NULL as distinct so the
--    many "no GSTIN yet" rows coexist; once a value is set, it must
--    be unique. If existing duplicates exist (per the pre-migration
--    check), this statement will fail until ops resolves them.
CREATE UNIQUE INDEX "sellers_gstin_key"      ON "sellers" ("gstin");
CREATE UNIQUE INDEX "sellers_pan_number_key" ON "sellers" ("pan_number");

-- 5) seller_bank_details ----------------------------------------------
CREATE TABLE "seller_bank_details" (
    "id"                    TEXT NOT NULL,
    "seller_id"             TEXT NOT NULL,
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

    CONSTRAINT "seller_bank_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_bank_details_seller_id_key"
    ON "seller_bank_details" ("seller_id");

ALTER TABLE "seller_bank_details"
    ADD CONSTRAINT "seller_bank_details_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
