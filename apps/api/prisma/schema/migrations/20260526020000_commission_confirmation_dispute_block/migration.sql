-- Phase 136 — return-window commission confirmation: dispute-blocking +
-- stable settlement date + unfreeze provenance.

-- Stable settlement date + unfreeze timestamp on commission records.
ALTER TABLE "commission_records" ADD COLUMN "settlable_at" TIMESTAMP(3);
ALTER TABLE "commission_records" ADD COLUMN "unfrozen_at" TIMESTAMP(3);

-- Settlement now selects PENDING records by settlable_at (with a createdAt
-- fallback for legacy rows); index the access path.
CREATE INDEX "commission_records_status_settlable_at_idx"
  ON "commission_records"("status", "settlable_at");

-- SubOrder ↔ Dispute relation: FK on the existing dispute.sub_order_id scalar
-- so the commission processor can exclude sub-orders with an active dispute in
-- one transactional query. Verified 0 orphan dispute.sub_order_id values before
-- adding the constraint.
ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_sub_order_id_fkey"
  FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
