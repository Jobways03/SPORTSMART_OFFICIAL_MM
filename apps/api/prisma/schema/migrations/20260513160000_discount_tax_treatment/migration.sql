-- Phase 4 of the GST/tax/invoice system — discount tax treatment.
--
-- Adds the DiscountTaxTreatment enum and `taxTreatment` column on
-- Discount. Default PRE_SUPPLY_TRANSACTIONAL preserves current
-- behaviour (discount reduces taxable value before GST per CGST
-- Section 15).
--
-- See docs/tax/CA.md §A Phase 4 log and docs/tax/GST_ASSUMPTIONS.md
-- §2 row "Discount tax treatment defaults".
--
-- Tax-treatment semantics:
--   PRE_SUPPLY_TRANSACTIONAL  — Engine subtracts discount from gross,
--                                computes GST on taxable = (gross - discount).
--                                Allocation ledger created. Default for
--                                customer-facing coupons / cart discounts.
--   POST_SUPPLY_LINKED        — Discount granted AFTER invoice issuance,
--                                linked to a specific invoice via credit
--                                note. Engine does NOT reduce taxable at
--                                this stage; credit note in Phase 11
--                                produces the GST reversal.
--   POST_SUPPLY_UNLINKED      — Goodwill / commercial adjustment with no
--                                taxable-value reduction; engine does NOT
--                                reduce taxable. No credit note. Treat as
--                                business expense via wallet_adjustments.
--   DISPLAY_ONLY              — MRP slash / "₹999 → ₹799" marketing display.
--                                Engine sees gross = paid price (not MRP);
--                                no discount enters the allocation ledger;
--                                no GST impact.

CREATE TYPE "DiscountTaxTreatment" AS ENUM (
  'PRE_SUPPLY_TRANSACTIONAL',
  'POST_SUPPLY_LINKED',
  'POST_SUPPLY_UNLINKED',
  'DISPLAY_ONLY'
);

ALTER TABLE "discounts"
  ADD COLUMN "tax_treatment" "DiscountTaxTreatment"
    NOT NULL DEFAULT 'PRE_SUPPLY_TRANSACTIONAL';

CREATE INDEX "discounts_tax_treatment_idx" ON "discounts"("tax_treatment");
