-- Phase 160 (E-Way Bill cancel/override flow audit remediation).
--
--   B1   cancel_initiated_at / cancel_initiated_by — two-phase cancel markers
--        written before the NIC call (paired with the CANCELLATION_PENDING
--        state added in the 040000 migration).
--   #7   provider_cancel_reference — NIC's cancellation reference number,
--        hoisted out of the raw JSON into a queryable column.
--   #8   raw_cancel_response_json — cancel response kept separate so it no
--        longer overwrites the original generate response.
--   #2   pre_override_status — the status held before OVERRIDDEN, for
--        report accuracy + accurate revoke restoration.
--   #schema — index on cancelled_at for "cancelled in period X" reports.

ALTER TABLE "e_way_bills"
  ADD COLUMN "cancel_initiated_at"       TIMESTAMP(3),
  ADD COLUMN "cancel_initiated_by"       TEXT,
  ADD COLUMN "provider_cancel_reference" TEXT,
  ADD COLUMN "raw_cancel_response_json"  JSONB,
  ADD COLUMN "pre_override_status"       "EWayBillStatus";

CREATE INDEX "e_way_bills_cancelled_at_idx" ON "e_way_bills" ("cancelled_at");
