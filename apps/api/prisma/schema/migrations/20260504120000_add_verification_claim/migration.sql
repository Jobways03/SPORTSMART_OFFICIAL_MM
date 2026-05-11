-- Verification queue claim columns on master_orders. An ops verifier claims
-- a PLACED order; the claim auto-expires after 15 minutes (enforced by the
-- application's claim-next query, no background sweeper needed).
ALTER TABLE "master_orders"
  ADD COLUMN "claimed_by_admin_id" TEXT,
  ADD COLUMN "claimed_at"          TIMESTAMP(3),
  ADD COLUMN "claim_expires_at"    TIMESTAMP(3);

-- Composite index for the claim-next scan: filter by order_status='PLACED'
-- and (claimed_by_admin_id IS NULL OR claim_expires_at < NOW()).
CREATE INDEX "master_orders_order_status_claimed_by_admin_id_claim_expires__idx"
  ON "master_orders"("order_status", "claimed_by_admin_id", "claim_expires_at");

-- "My tray" — list of orders an admin currently has claimed.
CREATE INDEX "master_orders_claimed_by_admin_id_idx"
  ON "master_orders"("claimed_by_admin_id");
