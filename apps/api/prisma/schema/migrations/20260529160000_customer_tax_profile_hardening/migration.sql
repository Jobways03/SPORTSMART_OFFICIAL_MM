-- Phase 161 (Customer Tax Profile flow audit remediation).
--
--   #18  customer_tax_profiles.last_selected_at — set on each B2B order.
--   #8   customer_tax_profile_history — append-only field-change history
--        (NO FK to the profile: profiles are hard-deleted and the history,
--        incl. the DELETE event, must survive — same design as
--        gstin_verification_events).
--   B2   tax_documents.customer_tax_profile_id — snapshot FK to the buyer
--        profile (buyer identity itself is already snapshotted on the row).

ALTER TABLE "customer_tax_profiles"
  ADD COLUMN "last_selected_at" TIMESTAMP(3);

CREATE TABLE "customer_tax_profile_history" (
  "id"          TEXT NOT NULL,
  "profile_id"  TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "old_values"  JSONB,
  "new_values"  JSONB,
  "changed_by"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_tax_profile_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_tax_profile_history_profile_id_created_at_idx"
  ON "customer_tax_profile_history" ("profile_id", "created_at" DESC);
CREATE INDEX "customer_tax_profile_history_customer_id_created_at_idx"
  ON "customer_tax_profile_history" ("customer_id", "created_at" DESC);

ALTER TABLE "tax_documents" ADD COLUMN "customer_tax_profile_id" TEXT;
CREATE INDEX "tax_documents_customer_tax_profile_id_idx"
  ON "tax_documents" ("customer_tax_profile_id");
ALTER TABLE "tax_documents"
  ADD CONSTRAINT "tax_documents_customer_tax_profile_id_fkey"
  FOREIGN KEY ("customer_tax_profile_id") REFERENCES "customer_tax_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
