-- Add indexes on soft-delete, verification status, and hot-path scans.
--
-- - sellers.is_deleted / franchise_partners.is_deleted: every tenant-
--   scoped list/read AND every login guard filters these. Without the
--   index, filters degrade to a seq scan as the tables grow.
-- - sellers.verification_status / franchise_partners.verification_status:
--   admin verification screens filter on these; ditto for a seq scan
--   on the admin list endpoint.
-- - franchise_partners.contract_end_date:
--   FranchiseReservationCleanupService.checkExpiredContracts runs every
--   hour with WHERE contract_end_date < now() AND status='ACTIVE'. The
--   sweep was doing a seq scan on the full franchise table every tick.

-- CreateIndex
CREATE INDEX "sellers_is_deleted_idx" ON "sellers"("is_deleted");

-- CreateIndex
CREATE INDEX "sellers_verification_status_idx" ON "sellers"("verification_status");

-- CreateIndex
CREATE INDEX "franchise_partners_is_deleted_idx" ON "franchise_partners"("is_deleted");

-- CreateIndex
CREATE INDEX "franchise_partners_verification_status_idx" ON "franchise_partners"("verification_status");

-- CreateIndex
CREATE INDEX "franchise_partners_contract_end_date_idx" ON "franchise_partners"("contract_end_date");
