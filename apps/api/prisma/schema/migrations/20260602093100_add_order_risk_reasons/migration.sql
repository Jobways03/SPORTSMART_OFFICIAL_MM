-- The OrderRiskReason model exists in the Prisma schema (orders.prisma) but
-- the `order_risk_reasons` table was never migrated into the database. The
-- risk-scoring service (orders/application/services/risk-scoring.service.ts)
-- runs tx.orderRiskReason.deleteMany / createMany while scoring an order, so
-- the missing table errors any order-risk flow. The OrderRiskReasonCode enum
-- already exists in the DB. Idempotent so it's safe where already applied.
CREATE TABLE IF NOT EXISTS "order_risk_reasons" (
    "id" TEXT NOT NULL,
    "master_order_id" TEXT NOT NULL,
    "reason_code" "OrderRiskReasonCode" NOT NULL,
    "reason_text" TEXT NOT NULL,
    "score_delta" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_risk_reasons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "order_risk_reasons_master_order_id_idx" ON "order_risk_reasons"("master_order_id");
CREATE INDEX IF NOT EXISTS "order_risk_reasons_reason_code_idx" ON "order_risk_reasons"("reason_code");
CREATE INDEX IF NOT EXISTS "order_risk_reasons_reason_code_created_at_idx" ON "order_risk_reasons"("reason_code", "created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_risk_reasons_master_order_id_fkey') THEN
    ALTER TABLE "order_risk_reasons"
      ADD CONSTRAINT "order_risk_reasons_master_order_id_fkey"
      FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
