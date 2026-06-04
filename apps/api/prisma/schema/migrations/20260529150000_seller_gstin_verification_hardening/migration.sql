-- Phase 161 (Seller GSTIN Verification flow audit remediation).
--
--   B3  seller_gstins.is_verified — true only when found AND ACTIVE.
--   B2  last_checked_at — every attempt (verified_at stays = last SUCCESS).
--   B1  legal_name_mismatch (queryable) + gst_legal_name (portal-returned).
--   B5  gstn_portal_status / gstn_raw_response_json / last_verified_provider
--       + verification_failure_reason — the full provider audit trail.
--   B4/#8  gstin_verification_events — append-only per-attempt history for
--          both seller + customer flows.
--   #16/#17 indexes on is_verified + legal_name_mismatch for the KYC queue.

ALTER TABLE "seller_gstins"
  ADD COLUMN "is_verified"                 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "legal_name_mismatch"         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gst_legal_name"              TEXT,
  ADD COLUMN "gstn_portal_status"          TEXT,
  ADD COLUMN "gstn_raw_response_json"      JSONB,
  ADD COLUMN "verification_failure_reason" TEXT,
  ADD COLUMN "last_verified_provider"      TEXT,
  ADD COLUMN "last_checked_at"             TIMESTAMP(3);

-- Backfill: rows that already carry a verifiedAt were stamped under the old
-- (always-set-on-attempt) logic. We conservatively treat an existing
-- verifiedAt as a prior successful check (the stub only ever returned ACTIVE
-- for found GSTINs) so historical "verified" rows stay verified.
UPDATE "seller_gstins" SET "is_verified" = true, "last_checked_at" = "verified_at"
  WHERE "verified_at" IS NOT NULL;

CREATE INDEX "seller_gstins_is_verified_idx"        ON "seller_gstins" ("is_verified");
CREATE INDEX "seller_gstins_legal_name_mismatch_idx" ON "seller_gstins" ("legal_name_mismatch");

ALTER TABLE "customer_tax_profiles"
  ADD COLUMN "legal_name_mismatch"         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gst_legal_name"              TEXT,
  ADD COLUMN "gstn_portal_status"          TEXT,
  ADD COLUMN "gstn_raw_response_json"      JSONB,
  ADD COLUMN "verification_failure_reason" TEXT,
  ADD COLUMN "last_verified_provider"      TEXT,
  ADD COLUMN "last_checked_at"             TIMESTAMP(3);

UPDATE "customer_tax_profiles" SET "last_checked_at" = "verified_at"
  WHERE "verified_at" IS NOT NULL;

CREATE INDEX "customer_tax_profiles_legal_name_mismatch_idx"
  ON "customer_tax_profiles" ("legal_name_mismatch");

CREATE TABLE "gstin_verification_events" (
  "id"                  TEXT NOT NULL,
  "target_type"         TEXT NOT NULL,
  "target_id"           TEXT NOT NULL,
  "gstin"               TEXT NOT NULL,
  "provider"            TEXT NOT NULL,
  "actor_id"            TEXT,
  "found"               BOOLEAN NOT NULL,
  "verified"            BOOLEAN NOT NULL,
  "status"              TEXT NOT NULL,
  "portal_legal_name"   TEXT,
  "legal_name_mismatch" BOOLEAN NOT NULL DEFAULT false,
  "failure_reason"      TEXT,
  "raw_response_json"   JSONB,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gstin_verification_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "gstin_verification_events_target_idx"
  ON "gstin_verification_events" ("target_type", "target_id", "created_at" DESC);
CREATE INDEX "gstin_verification_events_gstin_idx"
  ON "gstin_verification_events" ("gstin", "created_at" DESC);
