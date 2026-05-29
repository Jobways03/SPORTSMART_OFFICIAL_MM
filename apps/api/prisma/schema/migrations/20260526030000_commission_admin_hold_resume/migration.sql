-- Phase 137 — admin commission Hold/Resume (fraud-suspicion / operational review).

-- Per-record hold state (heldByAdminId distinguishes an admin hold from the
-- system return-driven freeze, which leaves it null). holdReason is dedicated
-- so it no longer overloads adjustmentReason.
ALTER TABLE "commission_records" ADD COLUMN "held_by_admin_id" TEXT;
ALTER TABLE "commission_records" ADD COLUMN "held_at" TIMESTAMP(3);
ALTER TABLE "commission_records" ADD COLUMN "hold_reason" TEXT;
ALTER TABLE "commission_records" ADD COLUMN "previous_status" "CommissionRecordStatus";
ALTER TABLE "commission_records" ADD COLUMN "resumed_by_admin_id" TEXT;
ALTER TABLE "commission_records" ADD COLUMN "resumed_at" TIMESTAMP(3);
ALTER TABLE "commission_records" ADD COLUMN "resume_reason" TEXT;

-- Full hold/resume/freeze/unfreeze timeline.
CREATE TYPE "CommissionHoldAction" AS ENUM (
  'HOLD', 'RESUME', 'SYSTEM_FREEZE', 'SYSTEM_UNFREEZE'
);

CREATE TABLE "commission_hold_history" (
  "id"                   TEXT NOT NULL,
  "commission_record_id" TEXT NOT NULL,
  "action"               "CommissionHoldAction" NOT NULL,
  "actor_type"           TEXT NOT NULL,
  "actor_id"             TEXT,
  "from_status"          "CommissionRecordStatus" NOT NULL,
  "to_status"            "CommissionRecordStatus" NOT NULL,
  "reason"               TEXT NOT NULL,
  "related_return_id"    TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_hold_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "commission_hold_history_commission_record_id_created_at_idx"
  ON "commission_hold_history"("commission_record_id", "created_at");
ALTER TABLE "commission_hold_history"
  ADD CONSTRAINT "commission_hold_history_commission_record_id_fkey"
  FOREIGN KEY ("commission_record_id") REFERENCES "commission_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
