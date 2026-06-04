-- Phase 235/236/237 — Procurement audits. Additive: first-class actor columns
-- on the request header (the ProcurementRequestEvent history already records
-- the actor per transition; these make it queryable on the row), an MRP
-- snapshot captured at request creation, and a per-product index. Not yet
-- applied (branch sd001); deploy with `prisma migrate deploy`.

ALTER TABLE "procurement_requests" ADD COLUMN IF NOT EXISTS "requested_by_staff_id" TEXT;
ALTER TABLE "procurement_requests" ADD COLUMN IF NOT EXISTS "dispatched_by" TEXT;
ALTER TABLE "procurement_requests" ADD COLUMN IF NOT EXISTS "received_by" TEXT;
ALTER TABLE "procurement_requests" ADD COLUMN IF NOT EXISTS "cancelled_by" TEXT;
ALTER TABLE "procurement_requests" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);
ALTER TABLE "procurement_requests" ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT;

ALTER TABLE "procurement_request_items" ADD COLUMN IF NOT EXISTS "mrp_snapshot" DECIMAL(10,2);
CREATE INDEX IF NOT EXISTS "procurement_request_items_product_id_idx"
  ON "procurement_request_items" ("product_id");
