-- Phase 230-234 — Allocation / routing / pincode hardening.
-- Audits #229 (pincode lookup), #230 (eligible-seller), #231 (eligible-node),
-- #232 (allocation preview), #233 (allocation analytics), #234 (exception queue).
-- Additive columns + enums + indexes + defensive CHECK/FK constraints. Not yet
-- applied (branch sd001); deploy with `prisma migrate deploy`.

-- ── #229 Pincode Lookup: PostOffice stateCode + updatedAt + dedupe key ───────
ALTER TABLE "post_offices" ADD COLUMN IF NOT EXISTS "state_code" TEXT;
ALTER TABLE "post_offices" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Dedupe key so the seed runs idempotently (createMany skipDuplicates). If a
-- prior non-idempotent seed left duplicate (pincode, office_name) rows,
-- de-duplicate BEFORE deploy:
--   DELETE FROM post_offices a USING post_offices b
--   WHERE a.ctid < b.ctid AND a.pincode = b.pincode AND a.office_name = b.office_name;
CREATE UNIQUE INDEX IF NOT EXISTS "post_offices_pincode_office_name_key"
  ON "post_offices" ("pincode", "office_name");

-- ── #233 Allocation Analytics: provenance + outcome + reason enums ───────────
DO $$ BEGIN
  CREATE TYPE "AllocationEventSource" AS ENUM ('LIVE','REALLOCATION','MANUAL_REASSIGNMENT','LISTING','PREVIEW','STOREFRONT');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "AllocationOutcome" AS ENUM ('PRIMARY_SERVICEABLE','FALLBACK_SERVICEABLE','UNSERVICEABLE','REASSIGNED');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE "AllocationReasonCode" AS ENUM ('PRIMARY_HIGHEST_SCORE','REALLOCATED_FROM_FAILED','NO_SERVICEABLE_NODE','MANUAL_REASSIGN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "allocation_logs" ADD COLUMN IF NOT EXISTS "event_source" "AllocationEventSource" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "allocation_logs" ADD COLUMN IF NOT EXISTS "outcome" "AllocationOutcome";
ALTER TABLE "allocation_logs" ADD COLUMN IF NOT EXISTS "reason_code" "AllocationReasonCode";

CREATE INDEX IF NOT EXISTS "allocation_logs_created_at_idx" ON "allocation_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "allocation_logs_outcome_created_at_idx" ON "allocation_logs" ("outcome","created_at");
CREATE INDEX IF NOT EXISTS "allocation_logs_event_source_created_at_idx" ON "allocation_logs" ("event_source","created_at");
CREATE INDEX IF NOT EXISTS "allocation_logs_allocated_node_type_idx" ON "allocation_logs" ("allocated_node_type");
CREATE INDEX IF NOT EXISTS "allocation_logs_is_reallocated_idx" ON "allocation_logs" ("is_reallocated");

-- Backfill outcome for existing rows so historical analytics isn't blank.
UPDATE "allocation_logs" SET "outcome" =
  CASE
    WHEN "is_reallocated" = true THEN 'FALLBACK_SERVICEABLE'::"AllocationOutcome"
    WHEN "allocated_seller_id" IS NOT NULL OR "allocated_franchise_id" IS NOT NULL THEN 'PRIMARY_SERVICEABLE'::"AllocationOutcome"
    ELSE 'UNSERVICEABLE'::"AllocationOutcome"
  END
WHERE "outcome" IS NULL;
-- Tag historical admin-reassign rows (customer_pincode sentinel) so they don't
-- inflate LIVE checkout counts and the REASSIGNED counter is populated.
UPDATE "allocation_logs"
  SET "event_source" = 'MANUAL_REASSIGNMENT'::"AllocationEventSource",
      "outcome" = 'REASSIGNED'::"AllocationOutcome"
WHERE "customer_pincode" = 'ADMIN_REASSIGN';

-- ── #230/#232 Seller fulfillment hold ───────────────────────────────────────
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "fulfillment_hold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "fulfillment_hold_reason" TEXT;
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "fulfillment_hold_at" TIMESTAMP(3);
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "fulfillment_hold_by" TEXT;
CREATE INDEX IF NOT EXISTS "sellers_fulfillment_hold_idx" ON "sellers" ("fulfillment_hold");

-- ── #231 Franchise dispatch SLA + COD eligibility + hold ─────────────────────
ALTER TABLE "franchise_partners" ADD COLUMN IF NOT EXISTS "dispatch_sla_days" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "franchise_partners" ADD COLUMN IF NOT EXISTS "cod_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "franchise_partners" ADD COLUMN IF NOT EXISTS "fulfillment_hold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "franchise_partners" ADD COLUMN IF NOT EXISTS "fulfillment_hold_reason" TEXT;
ALTER TABLE "franchise_partners" ADD COLUMN IF NOT EXISTS "fulfillment_hold_at" TIMESTAMP(3);
ALTER TABLE "franchise_partners" ADD COLUMN IF NOT EXISTS "fulfillment_hold_by" TEXT;
CREATE INDEX IF NOT EXISTS "franchise_partners_fulfillment_hold_idx" ON "franchise_partners" ("fulfillment_hold");

-- ── #234 Exception queue: reason enum + MasterOrder provenance columns ───────
DO $$ BEGIN
  CREATE TYPE "AllocationExceptionReason" AS ENUM ('NO_PINCODE_ON_ORDER','PINCODE_UNSERVICEABLE','NO_STOCK_AVAILABLE','NO_NODE_MAPPED','SELLER_REJECTED','NODE_SUSPENDED','UNKNOWN');
EXCEPTION WHEN duplicate_object THEN null; END $$;
ALTER TABLE "master_orders" ADD COLUMN IF NOT EXISTS "exception_reason" "AllocationExceptionReason";
ALTER TABLE "master_orders" ADD COLUMN IF NOT EXISTS "exception_reason_detail" TEXT;
ALTER TABLE "master_orders" ADD COLUMN IF NOT EXISTS "exception_entered_at" TIMESTAMP(3);

-- ── #231 SubOrder invariants: node-type CHECK + exactly-one-node CHECK ───────
-- NOT VALID so existing rows aren't retro-validated; new/updated rows ARE
-- enforced. Prisma cannot express CHECK constraints, so they live here as
-- DB-level defence-in-depth (same pattern as the partial-unique indexes
-- elsewhere in this schema).
DO $$ BEGIN
  ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_fulfillment_node_type_check"
    CHECK ("fulfillment_node_type" IN ('SELLER','FRANCHISE')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_exactly_one_node_check"
    CHECK (("seller_id" IS NOT NULL) <> ("franchise_id" IS NOT NULL)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── #231 SubOrder FK onDelete: Cascade/SetNull → Restrict (protect orders) ───
ALTER TABLE "sub_orders" DROP CONSTRAINT IF EXISTS "sub_orders_seller_id_fkey";
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sub_orders" DROP CONSTRAINT IF EXISTS "sub_orders_franchise_id_fkey";
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
