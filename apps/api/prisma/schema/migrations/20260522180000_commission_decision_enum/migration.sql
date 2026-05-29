-- Phase 75 (2026-05-22) — Phase 73 reject-flow audit Gap #10.
-- New CommissionDecision enum + SubOrder.commission_decision column.
-- Settlement sweep continues to read commission_processed (no
-- breaking change); analytics + finance reads the new column for
-- the actual decision (PROCESSED vs NOT_APPLICABLE vs PENDING).

CREATE TYPE "CommissionDecision" AS ENUM ('PENDING', 'PROCESSED', 'NOT_APPLICABLE');

ALTER TABLE "sub_orders"
  ADD COLUMN "commission_decision" "CommissionDecision" NOT NULL DEFAULT 'PENDING';

-- Backfill from existing commission_processed semantic:
--   commission_processed=true AND acceptStatus=REJECTED → NOT_APPLICABLE
--   commission_processed=true AND acceptStatus<>REJECTED → PROCESSED
--   commission_processed=false → PENDING (already the default)
UPDATE "sub_orders"
SET    "commission_decision" = 'NOT_APPLICABLE'
WHERE  "commission_processed" = TRUE
  AND  "accept_status"        = 'REJECTED';

UPDATE "sub_orders"
SET    "commission_decision" = 'PROCESSED'
WHERE  "commission_processed" = TRUE
  AND  "accept_status"        <> 'REJECTED'
  AND  "commission_decision"  = 'PENDING';

-- Composite index — finance reports filter by (commission_decision,
-- delivered_at) for monthly settlement reconciliation.
CREATE INDEX "sub_orders_commission_decision_idx"
  ON "sub_orders" ("commission_decision");
