-- Phase 13 GST — Wallet adjustments (goodwill + time-barred refunds).
--
-- A wallet_adjustment is the BUSINESS-LAYER record of "we owe this
-- customer N paise but the credit-note path can't (or shouldn't)
-- carry the money". Once approved, it produces a wallet_transactions
-- row of type CREDIT_ADJUSTMENT — the wallet ledger is the source of
-- truth for the customer's balance.
--
-- Why a separate table from wallet_transactions:
--   1. We need to capture GST context (which source invoice, which
--      tax components the platform is absorbing) that the wallet
--      ledger doesn't carry.
--   2. We need an approval workflow with a pending state before the
--      money actually moves — small goodwill credits auto-approve,
--      high-value ones queue for finance review.
--   3. Time-barred credit notes route here AFTER Phase 12's cron
--      flagged them; the adjustment row carries the AdminTask audit
--      trail forward.
--
-- Phase 12 cron currently opens AdminTask(GST_CREDIT_NOTE_TIME_BARRED)
-- when a return crosses the Sec 34 cutoff. Phase 13 introduces the
-- writer: the QC-side flow + the cron will both call
-- WalletAdjustmentService.requestForTimeBarredReturn(returnId) which
-- creates a wallet_adjustments row in PENDING_APPROVAL.

-- ── Enums ────────────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE "WalletAdjustmentKind" AS ENUM (
    -- Sec 34 cutoff already passed; refund must route through wallet.
    'TIME_BARRED_CREDIT_NOTE',
    -- Admin-initiated goodwill credit (apology, compensation, etc.).
    -- NOT linked to a return; no GST reversal happens.
    'GOODWILL',
    -- Admin-initiated debit (chargeback, fraud reversal).
    'MANUAL_DEBIT',
    -- Catch-all for cases not covered above. Forces `reason` to be
    -- meaningful at write time.
    'MANUAL_OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  CREATE TYPE "WalletAdjustmentStatus" AS ENUM (
    'PENDING_APPROVAL',
    'APPROVED',     -- terminal; wallet transaction posted.
    'REJECTED',     -- terminal; reason recorded.
    'REVERSED'      -- terminal; previously-APPROVED then unwound
                    -- via a compensating wallet entry.
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- ── Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wallet_adjustments" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,

  -- Customer + wallet linkage. Wallet may not yet exist for the user;
  -- the service layer ensures get-or-create before posting.
  "customer_id" TEXT NOT NULL,
  "wallet_id" TEXT,

  -- Business context (all nullable — only TIME_BARRED_CREDIT_NOTE
  -- carries a return/sub-order/invoice triple; GOODWILL may carry
  -- only a customer_id).
  "sub_order_id"             TEXT,
  "return_id"                TEXT,
  "source_tax_document_id"   TEXT,
  -- Idempotency key — typically `${kind}:${returnId|adminRequestId}`.
  -- The UNIQUE index below stops a retried QC submission or a cron
  -- re-run from creating a duplicate pending adjustment for the same
  -- return.
  "idempotency_key" TEXT NOT NULL,

  "kind"   "WalletAdjustmentKind"   NOT NULL,
  "status" "WalletAdjustmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',

  -- Signed amount in paise. Positive = credit to customer (the common
  -- case — refund or goodwill). Negative = debit (chargeback / fraud
  -- reversal). Stored signed so the wallet posting code can pass the
  -- value through without re-interpretation.
  "amount_in_paise" BIGINT NOT NULL,
  "currency"        TEXT NOT NULL DEFAULT 'INR',

  -- "Absorbed GST" snapshot — what the credit note WOULD have reversed
  -- if Section 34 weren't time-barring it. Carried so the GSTR-1 / 3B
  -- reports can report the absorbed amount separately. All nullable
  -- because GOODWILL / MANUAL_OTHER won't fill this in.
  "would_have_been_taxable_in_paise"   BIGINT,
  "would_have_been_cgst_in_paise"      BIGINT,
  "would_have_been_sgst_in_paise"      BIGINT,
  "would_have_been_igst_in_paise"      BIGINT,
  "would_have_been_total_tax_in_paise" BIGINT,

  "reason" TEXT NOT NULL,

  -- Audit trail
  "requested_by_admin_id"   TEXT,
  "requested_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "approved_by_admin_id"    TEXT,
  "approved_at"             TIMESTAMPTZ,
  "rejected_by_admin_id"    TEXT,
  "rejected_at"             TIMESTAMPTZ,
  "rejection_reason"        TEXT,

  -- Cross-reference to the wallet_transactions row created at approval
  -- time. Null until APPROVED + posted.
  "wallet_transaction_id"   TEXT,

  -- High-value gate. If amount exceeds the threshold (env-configurable),
  -- the row stays in PENDING_APPROVAL even when the caller has
  -- wallet.adjustment.create — only wallet.adjustment.approve can move
  -- it to APPROVED.
  "requires_dual_approval" BOOLEAN NOT NULL DEFAULT false,

  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "wallet_adjustments_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_adjustments_idempotency_key_key"
  ON "wallet_adjustments" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "wallet_adjustments_customer_id_idx"
  ON "wallet_adjustments" ("customer_id");
CREATE INDEX IF NOT EXISTS "wallet_adjustments_wallet_id_idx"
  ON "wallet_adjustments" ("wallet_id");
CREATE INDEX IF NOT EXISTS "wallet_adjustments_status_idx"
  ON "wallet_adjustments" ("status");
CREATE INDEX IF NOT EXISTS "wallet_adjustments_return_id_idx"
  ON "wallet_adjustments" ("return_id");
CREATE INDEX IF NOT EXISTS "wallet_adjustments_source_tax_document_id_idx"
  ON "wallet_adjustments" ("source_tax_document_id");
-- Finance queue: pending approvals oldest-first.
CREATE INDEX IF NOT EXISTS "wallet_adjustments_pending_queue_idx"
  ON "wallet_adjustments" ("requested_at")
  WHERE "status" = 'PENDING_APPROVAL';

-- ── Foreign keys ─────────────────────────────────────────────────
-- All FKs are RESTRICT-on-delete; we never want a wallet adjustment
-- to silently disappear because someone purged the parent return.
DO $$
BEGIN
  ALTER TABLE "wallet_adjustments"
    ADD CONSTRAINT "wallet_adjustments_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "wallet_adjustments"
    ADD CONSTRAINT "wallet_adjustments_wallet_id_fkey"
    FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "wallet_adjustments"
    ADD CONSTRAINT "wallet_adjustments_return_id_fkey"
    FOREIGN KEY ("return_id") REFERENCES "returns"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "wallet_adjustments"
    ADD CONSTRAINT "wallet_adjustments_source_tax_document_id_fkey"
    FOREIGN KEY ("source_tax_document_id") REFERENCES "tax_documents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE "wallet_adjustments"
    ADD CONSTRAINT "wallet_adjustments_wallet_transaction_id_fkey"
    FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;
