-- Phase B (P0) — Security follow-up patches identified in /security-review
-- of the prior migration. Three changes:
--
-- 1. discount_redemptions.discount_id FK → RESTRICT (was CASCADE).
--    Redemption rows are historical financial records tied to paid
--    orders. They must survive Discount deletion. (HIGH finding #2)
--
-- 2. discount_liability_ledger gets an idempotency_key column +
--    unique constraint. Without it a retry on a partially-failed
--    order-creation transaction can write duplicate ledger rows,
--    double-counting the liability for finance. (HIGH finding #4)
--
-- 3. discount_redemptions gets a partial unique index over
--    (discount_code_id, customer_id) for active rows
--    (RESERVED + REDEEMED). This is belt-and-suspenders against
--    a service-layer race — even if the row-lock around reservation
--    has a bug, the DB will reject duplicate active redemptions for
--    the same customer + code. (HIGH finding #1)

-- 1. Drop and recreate the FK with RESTRICT semantics.
ALTER TABLE "discount_redemptions"
  DROP CONSTRAINT "discount_redemptions_discount_id_fkey";

ALTER TABLE "discount_redemptions"
  ADD CONSTRAINT "discount_redemptions_discount_id_fkey"
    FOREIGN KEY ("discount_id") REFERENCES "discounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Idempotency key on liability ledger.
ALTER TABLE "discount_liability_ledger"
  ADD COLUMN "idempotency_key" TEXT;

-- Partial unique index — duplicate prevention for application-set
-- keys, but legacy / null keys are still allowed (multiple unattributed
-- entries OK).
CREATE UNIQUE INDEX "discount_liability_ledger_idem_key"
  ON "discount_liability_ledger" ("master_order_id", "discount_id", "liability_party", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 3. Partial unique index on active redemptions.
-- One active redemption per (customer, code) at a time. RELEASED /
-- CANCELLED rows are historical and don't count.
CREATE UNIQUE INDEX "discount_redemptions_active_per_customer_code"
  ON "discount_redemptions" ("discount_code_id", "customer_id")
  WHERE "status" IN ('RESERVED', 'REDEEMED') AND "discount_code_id" IS NOT NULL;

-- Same for code-less discounts (Discount.code without a child
-- DiscountCode row — backward compat for existing single-code campaigns).
CREATE UNIQUE INDEX "discount_redemptions_active_per_customer_discount"
  ON "discount_redemptions" ("discount_id", "customer_id")
  WHERE "status" IN ('RESERVED', 'REDEEMED') AND "discount_code_id" IS NULL;
