-- Phase 159j (2026-05-27) — Franchise KYC-verification append-only history.
--
-- The verification actor/reason columns (verification_reviewed_by/at,
-- verification_rejection_reason, verification_approval_notes) already exist on
-- franchise_partners (Phase 20). This adds the ordered transition trail so a
-- flipped verdict (e.g. VERIFIED → NOT_VERIFIED) is fully reconstructable —
-- mirrors franchise_status_history (Phase 159i).
CREATE TABLE IF NOT EXISTS "franchise_verification_events" (
  "id" TEXT NOT NULL,
  "franchise_id" TEXT NOT NULL,
  "from_status" TEXT NOT NULL,
  "to_status" TEXT NOT NULL,
  "changed_by_admin_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_verification_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "franchise_verification_events_franchise_id_created_at_idx"
  ON "franchise_verification_events" ("franchise_id", "created_at");
ALTER TABLE "franchise_verification_events"
  ADD CONSTRAINT "franchise_verification_events_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchise_partners" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
