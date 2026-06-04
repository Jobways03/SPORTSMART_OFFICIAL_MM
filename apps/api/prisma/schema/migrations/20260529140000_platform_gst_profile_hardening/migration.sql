-- Phase 161 (Platform GST Profile flow audit remediation — third of the
-- tax-master trio after HSN 20260529120000 + UQC 20260529130000).
--
--   B5   created_by / updated_by — actor attribution (never captured).
--   #12  version — optimistic-concurrency token; PlatformGstProfileHistory.
--   #11  deactivation_reason / set_default_reason — reason capture on the
--        two most consequential mutations.
--   #6   one ACTIVE profile per state + a single DEFAULT row — enforced by
--        PARTIAL unique indexes (also makes every findFirst({isDefault})
--        deterministic — closes the #13 non-determinism at the DB level).
--   B3   tax_documents.platform_gst_profile_id — snapshot FK to the minting
--        profile (supplier identity itself is already snapshotted on the row).

ALTER TABLE "platform_gst_profiles"
  ADD COLUMN "created_by"          TEXT,
  ADD COLUMN "updated_by"          TEXT,
  ADD COLUMN "version"             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deactivation_reason" TEXT,
  ADD COLUMN "set_default_reason"  TEXT;

-- #6 — at most one ACTIVE profile per GST state.
CREATE UNIQUE INDEX "platform_gst_profiles_active_state_uniq"
  ON "platform_gst_profiles" ("gst_state_code")
  WHERE "is_active" = true;

-- single-default invariant — at most one row with is_default = true.
-- Makes the consumers' findFirst({isDefault:true}) deterministic (#13).
CREATE UNIQUE INDEX "platform_gst_profiles_single_default_uniq"
  ON "platform_gst_profiles" ("is_default")
  WHERE "is_default" = true;

CREATE TABLE "platform_gst_profile_history" (
  "id"         TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "gstin"      TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "old_values" JSONB,
  "new_values" JSONB,
  "changed_by" TEXT,
  "reason"     TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_gst_profile_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_gst_profile_history_profile_id_created_at_idx"
  ON "platform_gst_profile_history" ("profile_id", "created_at" DESC);
ALTER TABLE "platform_gst_profile_history"
  ADD CONSTRAINT "platform_gst_profile_history_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "platform_gst_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- B3 — snapshot FK on invoices.
ALTER TABLE "tax_documents" ADD COLUMN "platform_gst_profile_id" TEXT;
CREATE INDEX "tax_documents_platform_gst_profile_id_idx"
  ON "tax_documents" ("platform_gst_profile_id");
ALTER TABLE "tax_documents"
  ADD CONSTRAINT "tax_documents_platform_gst_profile_id_fkey"
  FOREIGN KEY ("platform_gst_profile_id") REFERENCES "platform_gst_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
