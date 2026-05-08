-- Phase 1.4 — Decimal → paise dual-write migration (ADR-007).
--
-- Adds a `*_in_paise BIGINT` sibling next to every Decimal money column on the
-- refund / dispute / settlement / commission critical path. The new columns
-- are NOT NULL DEFAULT 0 so existing INSERTs that don't write them succeed.
-- A backfill UPDATE follows each ALTER TABLE so historic rows have the right
-- value.
--
-- Scope: 37 columns across returns / settlements / commission / orders / cod.
-- Catalog / discounts / franchise / affiliate / own-brand are deferred to a
-- later PR 1.4-extended (they aren't on the redesign's hot path).
--
-- Dual-write is enforced at runtime by `MoneyDualWriteMiddleware` (Prisma
-- $extends client extension). When `MONEY_DUAL_WRITE_ENABLED=true` it copies
-- every write to a Decimal money column into its `*_in_paise` sibling. Off
-- by default; flip to `true` after staging soak.

-- ─── returns / refunds ──────────────────────────────────────────────

ALTER TABLE "returns" ADD COLUMN "refund_amount_in_paise" BIGINT;
UPDATE "returns" SET "refund_amount_in_paise" = ROUND("refund_amount" * 100)::BIGINT
  WHERE "refund_amount" IS NOT NULL;

ALTER TABLE "return_items" ADD COLUMN "refund_amount_in_paise" BIGINT;
UPDATE "return_items" SET "refund_amount_in_paise" = ROUND("refund_amount" * 100)::BIGINT
  WHERE "refund_amount" IS NOT NULL;

ALTER TABLE "refund_transactions" ADD COLUMN "amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "refund_transactions" SET "amount_in_paise" = ROUND("amount" * 100)::BIGINT;

-- ─── orders ─────────────────────────────────────────────────────────

ALTER TABLE "master_orders" ADD COLUMN "total_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "master_orders" SET "total_amount_in_paise" = ROUND("total_amount" * 100)::BIGINT;

ALTER TABLE "master_orders" ADD COLUMN "discount_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "master_orders" SET "discount_amount_in_paise" = ROUND("discount_amount" * 100)::BIGINT;

ALTER TABLE "sub_orders" ADD COLUMN "sub_total_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "sub_orders" SET "sub_total_in_paise" = ROUND("sub_total" * 100)::BIGINT;

ALTER TABLE "order_items" ADD COLUMN "unit_price_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "order_items" SET "unit_price_in_paise" = ROUND("unit_price" * 100)::BIGINT;

ALTER TABLE "order_items" ADD COLUMN "total_price_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "order_items" SET "total_price_in_paise" = ROUND("total_price" * 100)::BIGINT;

-- ─── settlements ────────────────────────────────────────────────────

ALTER TABLE "settlement_cycles" ADD COLUMN "total_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "settlement_cycles" SET "total_amount_in_paise" = ROUND("total_amount" * 100)::BIGINT;

ALTER TABLE "settlement_cycles" ADD COLUMN "total_margin_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "settlement_cycles" SET "total_margin_in_paise" = ROUND("total_margin" * 100)::BIGINT;

ALTER TABLE "seller_settlements" ADD COLUMN "total_platform_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "seller_settlements" SET "total_platform_amount_in_paise" = ROUND("total_platform_amount" * 100)::BIGINT;

ALTER TABLE "seller_settlements" ADD COLUMN "total_settlement_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "seller_settlements" SET "total_settlement_amount_in_paise" = ROUND("total_settlement_amount" * 100)::BIGINT;

ALTER TABLE "seller_settlements" ADD COLUMN "total_platform_margin_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "seller_settlements" SET "total_platform_margin_in_paise" = ROUND("total_platform_margin" * 100)::BIGINT;

ALTER TABLE "settlement_adjustments" ADD COLUMN "amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "settlement_adjustments" SET "amount_in_paise" = ROUND("amount" * 100)::BIGINT;

-- ─── commission ─────────────────────────────────────────────────────

ALTER TABLE "commission_settings" ADD COLUMN "commission_value_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_settings" SET "commission_value_in_paise" = ROUND("commission_value" * 100)::BIGINT;

ALTER TABLE "commission_settings" ADD COLUMN "second_commission_value_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_settings" SET "second_commission_value_in_paise" = ROUND("second_commission_value" * 100)::BIGINT;

ALTER TABLE "commission_settings" ADD COLUMN "max_commission_amount_in_paise" BIGINT;
UPDATE "commission_settings" SET "max_commission_amount_in_paise" = ROUND("max_commission_amount" * 100)::BIGINT
  WHERE "max_commission_amount" IS NOT NULL;

ALTER TABLE "commission_records" ADD COLUMN "platform_price_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "platform_price_in_paise" = ROUND("platform_price" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "settlement_price_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "settlement_price_in_paise" = ROUND("settlement_price" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "total_platform_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "total_platform_amount_in_paise" = ROUND("total_platform_amount" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "total_settlement_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "total_settlement_amount_in_paise" = ROUND("total_settlement_amount" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "platform_margin_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "platform_margin_in_paise" = ROUND("platform_margin" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "unit_price_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "unit_price_in_paise" = ROUND("unit_price" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "total_price_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "total_price_in_paise" = ROUND("total_price" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "unit_commission_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "unit_commission_in_paise" = ROUND("unit_commission" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "total_commission_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "total_commission_in_paise" = ROUND("total_commission" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "admin_earning_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "admin_earning_in_paise" = ROUND("admin_earning" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "product_earning_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "product_earning_in_paise" = ROUND("product_earning" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "refunded_admin_earning_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "refunded_admin_earning_in_paise" = ROUND("refunded_admin_earning" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "vat_on_commission_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "vat_on_commission_in_paise" = ROUND("vat_on_commission" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "tax_commission_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "tax_commission_in_paise" = ROUND("tax_commission" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "shipping_commission_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_records" SET "shipping_commission_in_paise" = ROUND("shipping_commission" * 100)::BIGINT;

ALTER TABLE "commission_records" ADD COLUMN "original_admin_earning_in_paise" BIGINT;
UPDATE "commission_records" SET "original_admin_earning_in_paise" = ROUND("original_admin_earning" * 100)::BIGINT
  WHERE "original_admin_earning" IS NOT NULL;

ALTER TABLE "commission_reversal_records" ADD COLUMN "total_refund_amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_reversal_records" SET "total_refund_amount_in_paise" = ROUND("total_refund_amount" * 100)::BIGINT;

ALTER TABLE "commission_reversal_records" ADD COLUMN "refunded_admin_earning_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "commission_reversal_records" SET "refunded_admin_earning_in_paise" = ROUND("refunded_admin_earning" * 100)::BIGINT;

-- ─── COD decision logs + payouts ───────────────────────────────────

ALTER TABLE "cod_decision_logs" ADD COLUMN "order_total_in_paise" BIGINT;
UPDATE "cod_decision_logs" SET "order_total_in_paise" = ROUND("order_total_inr" * 100)::BIGINT
  WHERE "order_total_inr" IS NOT NULL;

ALTER TABLE "payouts" ADD COLUMN "amount_in_paise" BIGINT NOT NULL DEFAULT 0;
UPDATE "payouts" SET "amount_in_paise" = ROUND("amount" * 100)::BIGINT;

-- Backfill verification (optional in production migration; informational here):
-- After this migration, run the recon query in docs/runbooks/money-paise-migration.md
-- to verify per-table sums match between Decimal and paise columns.
