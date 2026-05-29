-- Phase 89 (2026-05-23) — EWB hardening.
--
-- New columns on e_way_bills:
--   • override revoke trail (Gap #7)
--   • override reason category (Gap #26)
--   • threshold + policy snapshot (Gap #24)
--   • predecessor link for cancel→regenerate chain (Gap #22)
--   • PDF artifact pointer (Gap #25)
--   • NIC ack number + date (Gap #1 reconciliation)
--   • retention expiry for raw payload purge (Gap #19)
-- New table e_way_bill_audit_logs (Gap #5).
-- New indexes for SIEM / inter-state / expiry / retention queries.
-- Depends on 20260523085000 which adds OVERRIDDEN to the enum.

ALTER TABLE "e_way_bills"
  ADD COLUMN "override_reason_category" TEXT,
  ADD COLUMN "override_revoked_at"      TIMESTAMP(3),
  ADD COLUMN "override_revoked_by"      TEXT,
  ADD COLUMN "override_revoke_reason"   TEXT,
  ADD COLUMN "threshold_applied_in_paise" BIGINT,
  ADD COLUMN "policy_version"           TEXT,
  ADD COLUMN "replaced_eway_bill_id"    TEXT,
  ADD COLUMN "pdf_url"                  TEXT,
  ADD COLUMN "pdf_rendered_at"          TIMESTAMP(3),
  ADD COLUMN "nic_ack_no"               TEXT,
  ADD COLUMN "nic_ack_date"             TIMESTAMP(3),
  ADD COLUMN "retention_expires_at"     TIMESTAMP(3);

ALTER TABLE "e_way_bills"
  ADD CONSTRAINT "e_way_bills_replaced_eway_bill_id_fkey"
  FOREIGN KEY ("replaced_eway_bill_id") REFERENCES "e_way_bills"("id")
  ON DELETE SET NULL;

CREATE INDEX "e_way_bills_override_admin_id_idx"
  ON "e_way_bills" ("override_admin_id");
CREATE INDEX "e_way_bills_from_state_code_to_state_code_idx"
  ON "e_way_bills" ("from_state_code", "to_state_code");
CREATE INDEX "e_way_bills_valid_until_status_idx"
  ON "e_way_bills" ("valid_until", "status");
CREATE INDEX "e_way_bills_retention_expires_at_idx"
  ON "e_way_bills" ("retention_expires_at");

CREATE TABLE "e_way_bill_audit_logs" (
  "id"            TEXT PRIMARY KEY,
  "eway_bill_id"  TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "from_status"   "EWayBillStatus",
  "to_status"     "EWayBillStatus",
  "actor_id"      TEXT,
  "actor_role"    TEXT,
  "reason"        TEXT,
  "payload_before" JSONB,
  "payload_after"  JSONB,
  "ip_address"    TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "e_way_bill_audit_logs_eway_bill_id_fkey"
    FOREIGN KEY ("eway_bill_id") REFERENCES "e_way_bills"("id")
    ON DELETE CASCADE
);

CREATE INDEX "e_way_bill_audit_logs_eway_bill_id_created_at_idx"
  ON "e_way_bill_audit_logs" ("eway_bill_id", "created_at" DESC);
CREATE INDEX "e_way_bill_audit_logs_action_created_at_idx"
  ON "e_way_bill_audit_logs" ("action", "created_at");
