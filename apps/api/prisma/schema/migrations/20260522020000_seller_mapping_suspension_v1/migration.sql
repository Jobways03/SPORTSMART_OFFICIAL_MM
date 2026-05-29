-- Phase 59 (2026-05-22) — bulk seller-mapping suspend/activate flow.
--
-- 1) New enum value SUSPENDED (audit Gap #2) so the bulk admin action
--    is distinguishable from STOPPED (Phase 56/57 single-mapping
--    admin action). ALTER TYPE ... ADD VALUE must run outside a
--    transaction; Prisma migrate executes each statement separately.
ALTER TYPE "MappingApprovalStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

-- 2) Audit columns for the bulk transitions (audit Gap #3). Pre-Phase-59
--    suspend was a blind isActive flip with no actor/reason captured;
--    the only forensic trace was a logger.log line. Reactivated*
--    columns mirror suspended* so a single row reads as a complete
--    suspend→reactivate cycle.
ALTER TABLE "seller_product_mappings"
  ADD COLUMN "suspended_by" TEXT,
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "suspension_reason" TEXT,
  ADD COLUMN "reactivated_by" TEXT,
  ADD COLUMN "reactivated_at" TIMESTAMP(3),
  ADD COLUMN "reactivation_reason" TEXT;

-- 3) Composite index for the hot suspend/activate query. The bulk
--    endpoint filters by (sellerId, approvalStatus, isActive) — without
--    this Postgres scans by sellerId index alone and re-filters every
--    row of the largest seller's catalog per call.
CREATE INDEX "seller_product_mappings_seller_id_approval_status_is_active_idx"
  ON "seller_product_mappings"("seller_id", "approval_status", "is_active");
