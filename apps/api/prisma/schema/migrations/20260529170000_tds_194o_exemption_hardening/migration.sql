-- Phase 161 (TDS §194-O exempt seller flow audit remediation).
--
--   B1   effective-dating (effective_from / effective_to) — exemption is
--        evaluated per filing period, enables annual revalidation/expiry.
--   B4   revocation trail (revoked_by / revoked_at / revoke_reason) — un-
--        exempting no longer nulls the attestation history.
--   #6   seller_tds_exemption_history — append-only grant/revoke trail.
--   #17  seller_settlements.tds_skip_reason — queryable EXEMPT/NO_ACTIVITY.

ALTER TABLE "sellers"
  ADD COLUMN "exempt_194o_effective_from" TIMESTAMP(3),
  ADD COLUMN "exempt_194o_effective_to"   TIMESTAMP(3),
  ADD COLUMN "exempt_194o_revoked_by"     TEXT,
  ADD COLUMN "exempt_194o_revoked_at"     TIMESTAMP(3),
  ADD COLUMN "exempt_194o_revoke_reason"  TEXT;

-- Backfill: legacy exempt sellers keep an OPEN-START window (effective_from
-- NULL = no lower bound) so the new period-window check leaves them exempt
-- for all current/future periods exactly as before. effective_to stays NULL
-- (open-ended) until the revalidation cron / an admin sets one.

CREATE INDEX "sellers_is_194o_exempt_effective_to_idx"
  ON "sellers" ("is_194o_exempt", "exempt_194o_effective_to");

CREATE TABLE "seller_tds_exemption_history" (
  "id"             TEXT NOT NULL,
  "seller_id"      TEXT NOT NULL,
  "action"         TEXT NOT NULL,
  "is_exempt"      BOOLEAN NOT NULL,
  "reason"         TEXT,
  "effective_from" TIMESTAMP(3),
  "effective_to"   TIMESTAMP(3),
  "changed_by"     TEXT,
  "change_reason"  TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seller_tds_exemption_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "seller_tds_exemption_history_seller_id_created_at_idx"
  ON "seller_tds_exemption_history" ("seller_id", "created_at" DESC);

ALTER TABLE "seller_settlements" ADD COLUMN "tds_skip_reason" TEXT;
