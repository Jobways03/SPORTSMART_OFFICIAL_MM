-- Phase 14 (2026-05-16) — DPDP §6 ConsentRecord projection.
--
-- One row per (user_id, purpose). The audit log keeps the legal
-- grant/revoke history; this table is the indexed projection used
-- by the customer privacy page + the marketing-dispatch eligibility
-- check. ConsentService dual-writes — audit row stays the source of
-- truth, the table is a denormalised mirror that lookups can JOIN
-- against directly.

CREATE TABLE "consent_records" (
    "id"          TEXT NOT NULL,
    "user_id"     TEXT NOT NULL,
    "purpose"     TEXT NOT NULL,
    "granted"     BOOLEAN NOT NULL,
    "source"      TEXT,
    "ip_address"  TEXT,
    "user_agent"  TEXT,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "consent_records_user_purpose_unique"
    ON "consent_records"("user_id", "purpose");
CREATE INDEX "consent_records_user_id_idx"
    ON "consent_records"("user_id");

ALTER TABLE "consent_records"
    ADD CONSTRAINT "consent_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
