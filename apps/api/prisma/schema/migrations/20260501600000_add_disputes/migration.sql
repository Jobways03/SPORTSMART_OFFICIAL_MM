-- CreateEnum
CREATE TYPE "DisputeKind" AS ENUM ('RETURN_REJECTED', 'WRONG_ITEM_RECEIVED', 'DAMAGED_IN_TRANSIT', 'MISSING_FROM_PARCEL', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'AWAITING_INFO', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisputeActorType" AS ENUM ('CUSTOMER', 'SELLER', 'ADMIN');

-- CreateTable
CREATE TABLE "dispute_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dispute_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "dispute_number" TEXT NOT NULL,
    "kind" "DisputeKind" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "severity" INTEGER NOT NULL DEFAULT 50,
    "master_order_id" TEXT,
    "sub_order_id" TEXT,
    "return_id" TEXT,
    "filed_by_type" "DisputeActorType" NOT NULL,
    "filed_by_id" TEXT NOT NULL,
    "filed_by_name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "assigned_admin_id" TEXT,
    "decision_by_admin_id" TEXT,
    "decision_at" TIMESTAMP(3),
    "decision_rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disputes_dispute_number_key" ON "disputes"("dispute_number");

-- CreateIndex
CREATE INDEX "disputes_status_severity_created_at_idx" ON "disputes"("status", "severity" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "disputes_filed_by_type_filed_by_id_idx" ON "disputes"("filed_by_type", "filed_by_id");

-- CreateIndex
CREATE INDEX "disputes_master_order_id_idx" ON "disputes"("master_order_id");

-- CreateIndex
CREATE INDEX "disputes_return_id_idx" ON "disputes"("return_id");

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "sender_type" "DisputeActorType" NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_messages_dispute_id_created_at_idx" ON "dispute_messages"("dispute_id", "created_at");

-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "caption" TEXT,
    "uploaded_by_type" "DisputeActorType" NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_evidence_dispute_id_idx" ON "dispute_evidence"("dispute_id");

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
