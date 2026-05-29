-- Phase 159w — GST Mode Toggle Flow audit.
-- First-class GstMode enum + append-only mode-change history (audit B3) +
-- per-order / per-invoice mode snapshot (audit B2).

-- 1. The mode enum. CREATE TYPE + immediate use in the same migration is fine
--    (only ALTER TYPE ... ADD VALUE has the in-transaction restriction).
CREATE TYPE "GstMode" AS ENUM ('OFF', 'AUDIT', 'STRICT');

-- 2. Append-only history of every tax-mode change.
CREATE TABLE "gst_mode_history" (
    "id" TEXT NOT NULL,
    "from_mode" "GstMode",
    "to_mode" "GstMode" NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "blocker_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gst_mode_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gst_mode_history_created_at_idx" ON "gst_mode_history" ("created_at");

-- 3. Per-order GST-mode snapshot (captured at placement).
ALTER TABLE "master_orders" ADD COLUMN "gst_mode_snapshot" "GstMode";

-- 4. Per-invoice GST-mode snapshot (captured at document generation).
ALTER TABLE "tax_documents" ADD COLUMN "gst_mode_snapshot" "GstMode";
