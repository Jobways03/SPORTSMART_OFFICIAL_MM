-- ============================================================================
-- Phase 203/204/205 — Audit hash-chain hardening
-- ============================================================================
-- Adds: deterministic content-verifiable hash chain (sequence_number,
-- schema_version, actor_type, request_id), a single-row serialization tip,
-- the verification-run/issue ledger, and the supporting enums.
--
-- Ordering is deliberate: every column is added NULLABLE / with a DEFAULT,
-- legacy rows are backfilled, and only THEN is hash set NOT NULL + the
-- genesis CHECK applied. Money is not involved; this is metadata only.
-- ============================================================================

-- ── Enums ──────────────────────────────────────────────────────────────────
CREATE TYPE "AuditActorType" AS ENUM (
  'CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE',
  'SYSTEM', 'CRON', 'WEBHOOK', 'PAYMENT_PROVIDER', 'LOGISTICS_PROVIDER'
);

CREATE TYPE "AuditChainIssueType" AS ENUM (
  'HASH_MISMATCH', 'PREVIOUS_HASH_MISMATCH', 'MISSING_SEQUENCE',
  'DUPLICATE_SEQUENCE', 'OUT_OF_ORDER_ROW', 'GENESIS_INVALID',
  'ANCHOR_MISMATCH', 'ROW_UNREADABLE', 'UNKNOWN'
);

CREATE TYPE "AuditChainVerificationRunType" AS ENUM ('FAST', 'FULL', 'SAMPLE');
CREATE TYPE "AuditChainVerificationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- ── AuditLog: new columns ───────────────────────────────────────────────────
-- sequence_number: BIGSERIAL-style. Add the column, attach a sequence, backfill
-- in createdAt order, then set the default + NOT NULL + UNIQUE.
ALTER TABLE "audit_logs" ADD COLUMN "sequence_number" BIGINT;

CREATE SEQUENCE IF NOT EXISTS "audit_logs_sequence_number_seq" OWNED BY "audit_logs"."sequence_number";

-- Backfill existing rows monotonically in (created_at, id) order so the
-- sequence agrees with the chain's existing prev_hash linkage.
WITH ordered AS (
  SELECT "id",
         ROW_NUMBER() OVER (ORDER BY "created_at" ASC, "id" ASC) AS rn
  FROM "audit_logs"
)
UPDATE "audit_logs" a
SET "sequence_number" = ordered.rn
FROM ordered
WHERE a."id" = ordered."id";

-- Advance the sequence past the backfilled max so new inserts don't collide.
-- 3-arg setval: is_called = (max > 0). On an empty table this leaves the
-- sequence so the FIRST insert gets 1 (no skipped genesis); on a populated
-- table the next insert gets max+1.
SELECT setval(
  'audit_logs_sequence_number_seq',
  GREATEST((SELECT COALESCE(MAX("sequence_number"), 0) FROM "audit_logs"), 1),
  (SELECT COALESCE(MAX("sequence_number"), 0) FROM "audit_logs") > 0
);

ALTER TABLE "audit_logs"
  ALTER COLUMN "sequence_number" SET DEFAULT nextval('audit_logs_sequence_number_seq'),
  ALTER COLUMN "sequence_number" SET NOT NULL;

ALTER TABLE "audit_logs" ADD COLUMN "actor_type" "AuditActorType";
ALTER TABLE "audit_logs" ADD COLUMN "request_id" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "schema_version" INTEGER NOT NULL DEFAULT 2;

-- Legacy rows were hashed with the old write-time `ts` recipe, which is not
-- content-verifiable. Tag them v1 so the verifier skips the content recompute
-- (still checks prev_hash linkage) instead of false-flagging every old row.
UPDATE "audit_logs" SET "schema_version" = 1 WHERE "created_at" < now();

-- hash: backfill any null hashes (legacy rows written before the chain landed)
-- with a deterministic sentinel so NOT NULL can be enforced. These rows are
-- v1/unverifiable anyway; the sentinel marks them explicitly.
UPDATE "audit_logs"
SET "hash" = 'legacy-unhashed-' || "id"
WHERE "hash" IS NULL;

ALTER TABLE "audit_logs" ALTER COLUMN "hash" SET NOT NULL;

-- Genesis-aware prev_hash invariant: exactly the lowest-sequence row may have a
-- NULL prev_hash. Enforced as a trigger (a plain CHECK can't reference an
-- aggregate over the table). Deferred to statement end so a batch insert that
-- temporarily looks headless still validates.
CREATE OR REPLACE FUNCTION "audit_logs_prev_hash_genesis_guard"()
RETURNS trigger AS $$
DECLARE
  min_seq BIGINT;
BEGIN
  SELECT MIN("sequence_number") INTO min_seq FROM "audit_logs";
  -- A non-genesis row MUST carry a prev_hash.
  IF NEW."sequence_number" <> min_seq AND NEW."prev_hash" IS NULL THEN
    RAISE EXCEPTION 'audit_logs: non-genesis row % has NULL prev_hash', NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_prev_hash_genesis_trg"
  AFTER INSERT OR UPDATE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION "audit_logs_prev_hash_genesis_guard"();

-- Indexes (deterministic export + correlation tracing).
CREATE UNIQUE INDEX "audit_logs_sequence_number_key" ON "audit_logs" ("sequence_number");
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs" ("request_id");

-- ── AuditChainTip: single-row serialization point ───────────────────────────
CREATE TABLE "audit_chain_tip" (
  "id"            TEXT NOT NULL DEFAULT 'singleton',
  "last_hash"     TEXT,
  "last_sequence" BIGINT,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "audit_chain_tip_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton from the current chain head so the first post-migration
-- write links correctly instead of starting a second genesis.
INSERT INTO "audit_chain_tip" ("id", "last_hash", "last_sequence", "updated_at")
SELECT 'singleton',
       (SELECT "hash" FROM "audit_logs" ORDER BY "sequence_number" DESC LIMIT 1),
       (SELECT "sequence_number" FROM "audit_logs" ORDER BY "sequence_number" DESC LIMIT 1),
       now()
ON CONFLICT ("id") DO NOTHING;

-- ── Verification run / issue ledger ─────────────────────────────────────────
CREATE TABLE "audit_chain_verification_runs" (
  "id"             TEXT NOT NULL,
  "run_type"       "AuditChainVerificationRunType" NOT NULL,
  "status"         "AuditChainVerificationStatus" NOT NULL DEFAULT 'RUNNING',
  "started_by"     TEXT,
  "started_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"   TIMESTAMP(3),
  "rows_checked"   INTEGER NOT NULL DEFAULT 0,
  "issues_found"   INTEGER NOT NULL DEFAULT 0,
  "result_summary" JSONB,
  "error_message"  TEXT,
  CONSTRAINT "audit_chain_verification_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_chain_verification_runs_started_at_idx" ON "audit_chain_verification_runs" ("started_at");
CREATE INDEX "audit_chain_verification_runs_status_idx" ON "audit_chain_verification_runs" ("status");

CREATE TABLE "audit_chain_verification_issues" (
  "id"                  TEXT NOT NULL,
  "verification_run_id" TEXT NOT NULL,
  "audit_log_id"        TEXT,
  "issue_type"          "AuditChainIssueType" NOT NULL,
  "severity"            TEXT NOT NULL,
  "expected_hash"       TEXT,
  "actual_hash"         TEXT,
  "details"             TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_chain_verification_issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_chain_verification_issues_run_fk"
    FOREIGN KEY ("verification_run_id")
    REFERENCES "audit_chain_verification_runs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "audit_chain_verification_issues_run_idx" ON "audit_chain_verification_issues" ("verification_run_id");
CREATE INDEX "audit_chain_verification_issues_type_idx" ON "audit_chain_verification_issues" ("issue_type");
