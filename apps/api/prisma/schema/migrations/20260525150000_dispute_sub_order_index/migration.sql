-- Phase 110 (2026-05-25) — index disputes by sub_order_id.
--
-- The seller portal lists disputes against a seller's sub-orders
-- (subOrderId IN (...)); without this index those queries scan the table.

CREATE INDEX "disputes_sub_order_id_idx" ON "disputes"("sub_order_id");
