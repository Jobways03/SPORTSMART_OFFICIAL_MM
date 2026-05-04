-- CreateEnum
CREATE TYPE "ReconciliationKind" AS ENUM ('PAYMENT', 'COD', 'SETTLEMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscrepancyKind" AS ENUM ('EXPECTED_NOT_FOUND', 'UNEXPECTED_RECORD', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "kind" "ReconciliationKind" NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'RUNNING',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "total_expected" INTEGER NOT NULL DEFAULT 0,
    "total_matched" INTEGER NOT NULL DEFAULT 0,
    "total_discrepancies" INTEGER NOT NULL DEFAULT 0,
    "expected_amount_in_paise" INTEGER NOT NULL DEFAULT 0,
    "matched_amount_in_paise" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "started_by_admin_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_runs_kind_period_start_idx" ON "reconciliation_runs"("kind", "period_start" DESC);

-- CreateIndex
CREATE INDEX "reconciliation_runs_status_idx" ON "reconciliation_runs"("status");

-- CreateTable
CREATE TABLE "reconciliation_discrepancies" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" "DiscrepancyKind" NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "master_order_id" TEXT,
    "order_number" TEXT,
    "external_ref" TEXT,
    "expected_in_paise" INTEGER,
    "actual_in_paise" INTEGER,
    "description" TEXT NOT NULL,
    "resolution_notes" TEXT,
    "resolved_by_admin_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_run_id_idx" ON "reconciliation_discrepancies"("run_id");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_status_created_at_idx" ON "reconciliation_discrepancies"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_master_order_id_idx" ON "reconciliation_discrepancies"("master_order_id");

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
