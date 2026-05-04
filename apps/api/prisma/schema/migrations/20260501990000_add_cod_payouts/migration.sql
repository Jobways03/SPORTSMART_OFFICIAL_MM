-- COD enums + tables
CREATE TYPE "CodRuleKind" AS ENUM ('PINCODE_ALLOW', 'PINCODE_DENY', 'VALUE_LIMIT', 'SELLER_DENY', 'CUSTOMER_RISK');

CREATE TABLE "cod_rules" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" "CodRuleKind" NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "conditions" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "cod_rules_active_priority_idx" ON "cod_rules"("active", "priority");

CREATE TABLE "cod_decision_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customer_id" TEXT,
  "pincode" TEXT,
  "seller_id" TEXT,
  "order_total_inr" DECIMAL(10,2),
  "eligible" BOOLEAN NOT NULL,
  "decided_by" TEXT NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "cod_decision_logs_customer_id_created_at_idx" ON "cod_decision_logs"("customer_id", "created_at" DESC);
CREATE INDEX "cod_decision_logs_eligible_created_at_idx" ON "cod_decision_logs"("eligible", "created_at" DESC);

-- Payout enums + tables
CREATE TYPE "PayoutBatchStatus" AS ENUM ('DRAFT', 'EXPORTED', 'PARTIALLY_PAID', 'COMPLETED', 'FAILED');

CREATE TABLE "payout_batches" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "exported_at" TIMESTAMP(3),
  "export_file_id" TEXT,
  "response_file_id" TEXT,
  "notes" TEXT,
  "created_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "payout_batches_status_idx" ON "payout_batches"("status");

CREATE TABLE "payouts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batch_id" TEXT NOT NULL,
  "settlement_id" TEXT NOT NULL,
  "seller_id" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "utr_reference" TEXT,
  "failure_reason" TEXT,
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payouts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "payouts_batch_id_settlement_id_key" ON "payouts"("batch_id", "settlement_id");
CREATE INDEX "payouts_seller_id_idx" ON "payouts"("seller_id");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
