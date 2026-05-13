-- Phase 2 (PR 2.5) — CHECK constraints on cart and order-flow invariants.
--
-- Same pattern as PR 2.4 (seller-mapping stock constraints): the
-- application already enforces these at the service layer, but the
-- DB-level constraint catches raw-SQL hotfixes, one-off scripts, and
-- any future code path that bypasses the typed service. NOT VALID so
-- the migration takes effect on new writes without scanning legacy
-- rows; a follow-up VALIDATE CONSTRAINT pass can run online.
--
-- Tables + invariants:
--
--   cart_items:
--     quantity > 0
--       PR 1.9 already gates this in cart.service.addItem; the
--       constraint covers stray inserts (anon-cart merge, ops backfill).
--
--   master_orders:
--     total_amount_in_paise >= 0
--       Negative totals would mean the platform owes the customer at
--       checkout — only possible via a coding bug. App enforcement is
--       implicit (subtotals are always >= 0); the CHECK makes it
--       explicit.
--
--   sub_orders:
--     sub_total_in_paise >= 0
--       Same reasoning, mirrored at the sub-order level.
--
--   order_items:
--     quantity > 0
--     unit_price_in_paise >= 0
--     total_price_in_paise >= 0
--       Cart → checkout → order_item is the only insert path; service
--       validates each, but the constraint covers replacement-order
--       creation and direct fixture writes used in dev.
--
-- The total_price ↔ unit_price * quantity relation is NOT enforced as
-- a CHECK because Postgres rejects multiplication-on-self-references
-- in NOT-VALID-able constraints (the inequality would need an actual
-- arithmetic invariant which can blow up on rounding-edge values).
-- Application invariants and money-dual-write tests handle that.

-- ── cart_items ──────────────────────────────────────────────────

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_positive"
  CHECK ("quantity" > 0)
  NOT VALID;

-- ── master_orders ───────────────────────────────────────────────

ALTER TABLE "master_orders"
  ADD CONSTRAINT "master_orders_total_amount_in_paise_non_negative"
  CHECK ("total_amount_in_paise" >= 0)
  NOT VALID;

-- ── sub_orders ──────────────────────────────────────────────────

ALTER TABLE "sub_orders"
  ADD CONSTRAINT "sub_orders_sub_total_in_paise_non_negative"
  CHECK ("sub_total_in_paise" >= 0)
  NOT VALID;

-- ── order_items ─────────────────────────────────────────────────

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive"
  CHECK ("quantity" > 0)
  NOT VALID;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_unit_price_in_paise_non_negative"
  CHECK ("unit_price_in_paise" >= 0)
  NOT VALID;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_total_price_in_paise_non_negative"
  CHECK ("total_price_in_paise" >= 0)
  NOT VALID;
