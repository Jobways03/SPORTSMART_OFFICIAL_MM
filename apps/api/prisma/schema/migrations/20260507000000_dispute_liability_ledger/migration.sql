-- Phase 12 (post-Phase-11) — Dispute liability + ledger redesign.
--
-- Separates the dispute decision from the money-flow execution per
-- ADR-016. DisputeService now writes liabilityParty + customerRemedy,
-- creates a RefundInstruction (when the customer is owed money), and
-- writes one of three ledger rows recording who bears the cost. Wallet
-- credit is executed only inside the RefundProcessor saga — never
-- directly from the dispute layer.

-- ── Enums ────────────────────────────────────────────────────────────

CREATE TYPE "LiabilityParty" AS ENUM (
  'NONE',         -- buyer-favoured-against (no money moved)
  'SELLER',       -- seller fault — recoverable from settlement
  'LOGISTICS',    -- courier fault — Sportsmart pays first, recovers via claim
  'PLATFORM',     -- Sportsmart fault or goodwill — platform absorbs
  'CUSTOMER'      -- customer fault — no payable created
);

CREATE TYPE "CustomerRemedy" AS ENUM (
  'FULL_REFUND',
  'PARTIAL_REFUND',
  'NO_REFUND',
  'GOODWILL_CREDIT'   -- non-recourse goodwill credit; bookkept as PlatformExpense
);

CREATE TYPE "SellerDebitStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED');

CREATE TYPE "LogisticsClaimStatus" AS ENUM (
  'PENDING',          -- filed, awaiting courier response
  'SUBMITTED',        -- forwarded to courier ops
  'ACCEPTED',         -- courier acknowledged liability
  'RECOVERED',        -- money received from courier
  'REJECTED',         -- courier denied — platform absorbs
  'CANCELLED'
);

CREATE TYPE "PlatformExpenseType" AS ENUM (
  'GOODWILL',
  'PLATFORM_FAULT',
  'EXCEPTION',        -- one-off ops adjustments
  'ROUNDING_ADJUSTMENT'
);

CREATE TYPE "LedgerSourceType" AS ENUM ('RETURN', 'DISPUTE', 'GOODWILL', 'MANUAL');

CREATE TYPE "AdminTaskKind" AS ENUM (
  'REFUND_INSTRUCTION_FAILED',
  'LOGISTICS_CLAIM_REVIEW',
  'SELLER_DEBIT_DISPUTED',
  'OTHER'
);

CREATE TYPE "AdminTaskStatus" AS ENUM ('OPEN', 'CLAIMED', 'RESOLVED', 'CANCELLED');

-- ── Dispute columns ──────────────────────────────────────────────────

ALTER TABLE "disputes"
  ADD COLUMN "liability_party"  "LiabilityParty",
  ADD COLUMN "customer_remedy"  "CustomerRemedy";

-- Both populated by DisputeService.decide; null on un-decided rows.
CREATE INDEX "disputes_liability_party_idx" ON "disputes"("liability_party");
CREATE INDEX "disputes_customer_remedy_idx" ON "disputes"("customer_remedy");

-- ── Return statuses ──────────────────────────────────────────────────

-- Four new terminal-ish statuses recording the dispute outcome on the
-- linked return. They live alongside QC_REJECTED / COMPLETED — a return
-- can land on any of these depending on whether a dispute later
-- overturned its QC decision (in customer's favour, partially, or
-- against). GOODWILL_CREDITED records goodwill-paid returns where no
-- liability was assigned.
ALTER TYPE "ReturnStatus" ADD VALUE 'DISPUTE_OVERTURNED';
ALTER TYPE "ReturnStatus" ADD VALUE 'DISPUTE_PARTIAL_OVERRIDE';
ALTER TYPE "ReturnStatus" ADD VALUE 'DISPUTE_CONFIRMED';
ALTER TYPE "ReturnStatus" ADD VALUE 'GOODWILL_CREDITED';

-- ── seller_debits ─────────────────────────────────────────────────────
--
-- Records money the platform must recover from the seller's next
-- settlement. Created when liabilityParty=SELLER on a dispute (or
-- equivalently when a return is QC_APPROVED — that path remains via
-- the existing CommissionReversalRecord). The settlement run reads
-- PENDING rows and offsets payouts.

CREATE TABLE "seller_debits" (
  "id"                       TEXT PRIMARY KEY,
  "seller_id"                TEXT NOT NULL,
  "source_type"              "LedgerSourceType" NOT NULL,
  "source_id"                TEXT NOT NULL,
  "order_id"                 TEXT,
  "sub_order_id"             TEXT,
  "amount_in_paise"          BIGINT NOT NULL,
  "reason"                   TEXT NOT NULL,
  "status"                   "SellerDebitStatus" NOT NULL DEFAULT 'PENDING',
  "settlement_adjusted_at"   TIMESTAMP(3),
  "settlement_id"            TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "seller_debits_source_unique"
  ON "seller_debits"("source_type", "source_id");
CREATE INDEX "seller_debits_seller_id_status_idx"
  ON "seller_debits"("seller_id", "status");
CREATE INDEX "seller_debits_settlement_id_idx"
  ON "seller_debits"("settlement_id");

-- ── platform_expenses ────────────────────────────────────────────────
--
-- Records cost the platform absorbs (goodwill credits, platform-fault
-- refunds, ops exception adjustments). Used by finance reporting; not
-- recoverable from any party.

CREATE TABLE "platform_expenses" (
  "id"               TEXT PRIMARY KEY,
  "source_type"      "LedgerSourceType" NOT NULL,
  "source_id"        TEXT NOT NULL,
  "expense_type"     "PlatformExpenseType" NOT NULL,
  "amount_in_paise"  BIGINT NOT NULL,
  "reason"           TEXT NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "platform_expenses_source_unique"
  ON "platform_expenses"("source_type", "source_id");
CREATE INDEX "platform_expenses_expense_type_idx"
  ON "platform_expenses"("expense_type");

-- ── logistics_claims ─────────────────────────────────────────────────
--
-- Records claims raised against couriers when the customer was paid
-- first by the platform. Lifecycle is recovery-tracking: PENDING →
-- SUBMITTED → ACCEPTED → RECOVERED (or REJECTED if courier denies, in
-- which case finance reclassifies to a PlatformExpense).

CREATE TABLE "logistics_claims" (
  "id"               TEXT PRIMARY KEY,
  "source_type"      "LedgerSourceType" NOT NULL,
  "source_id"        TEXT NOT NULL,
  "courier_name"     TEXT,
  "awb_number"       TEXT,
  "amount_in_paise"  BIGINT NOT NULL,
  "reason"           TEXT NOT NULL,
  "status"           "LogisticsClaimStatus" NOT NULL DEFAULT 'PENDING',
  "submitted_at"     TIMESTAMP(3),
  "recovered_at"     TIMESTAMP(3),
  "evidence_file_id" TEXT,
  "notes"            TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "logistics_claims_source_unique"
  ON "logistics_claims"("source_type", "source_id");
CREATE INDEX "logistics_claims_status_idx"
  ON "logistics_claims"("status");
CREATE INDEX "logistics_claims_awb_number_idx"
  ON "logistics_claims"("awb_number");

-- ── admin_tasks ──────────────────────────────────────────────────────
--
-- Generic ops queue. Created when the saga can't auto-resolve (failed
-- refund instruction, disputed seller debit, logistics claim awaiting
-- review). The same row gets surfaced in the admin dashboard's "Action
-- needed" queue and gets claimed/resolved by an admin.

CREATE TABLE "admin_tasks" (
  "id"               TEXT PRIMARY KEY,
  "kind"             "AdminTaskKind" NOT NULL,
  "source_type"      "LedgerSourceType" NOT NULL,
  "source_id"        TEXT NOT NULL,
  "status"           "AdminTaskStatus" NOT NULL DEFAULT 'OPEN',
  "reason"           TEXT NOT NULL,
  "assigned_to"      TEXT,
  "claimed_at"       TIMESTAMP(3),
  "resolved_at"      TIMESTAMP(3),
  "resolved_by"      TEXT,
  "resolution_note"  TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique on (kind, sourceType, sourceId) so a retry of the saga that
-- creates the same task twice doesn't queue duplicates for ops.
CREATE UNIQUE INDEX "admin_tasks_kind_source_unique"
  ON "admin_tasks"("kind", "source_type", "source_id");
CREATE INDEX "admin_tasks_status_idx"
  ON "admin_tasks"("status");
CREATE INDEX "admin_tasks_assigned_to_idx"
  ON "admin_tasks"("assigned_to");
