CREATE TABLE "settlement_adjustments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "settlement_id" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "created_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "settlement_adjustments_settlement_id_idx" ON "settlement_adjustments"("settlement_id");
