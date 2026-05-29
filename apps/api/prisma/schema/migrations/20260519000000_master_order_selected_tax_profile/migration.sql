-- Phase 37 (2026-05-19) — checkout-time B2B GSTIN picker.
--
-- Lets a buyer with multiple registered CustomerTaxProfile rows pick
-- which one this order's invoice goes against, without changing the
-- global default. Without this column the tax-document service always
-- picks the customer's isDefault=true profile.
--
-- Strategy:
--   1. Nullable text column on master_orders — null means "use whichever
--      profile is isDefault at invoice time", preserving the prior
--      behaviour for legacy rows + customers with only one profile.
--   2. No FK constraint: a profile can be deleted after the order is
--      placed, and we want the order to keep the snapshot reference
--      for audit. The tax-document service resolves the row by ID and
--      falls back to the default if it's been deleted.
--
-- Rollback: DROP COLUMN — safe; tax-document.service tolerates the
-- column being absent.

ALTER TABLE "master_orders"
    ADD COLUMN "selected_tax_profile_id" TEXT;

CREATE INDEX "master_orders_selected_tax_profile_idx"
    ON "master_orders" ("selected_tax_profile_id");
