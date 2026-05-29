-- Phase 92 (2026-05-23) — Return Eligibility hardening.
--
-- Gap #1 / #2 — Product + Category returnability columns.
-- Gap #11      — OrderItemKind enum + itemKind column + returnability
--                snapshot columns on order_items.
-- Gap #20      — Return.return_policy_snapshot_json.

CREATE TYPE "OrderItemKind" AS ENUM (
  'PHYSICAL',
  'DIGITAL',
  'SERVICE',
  'SUBSCRIPTION',
  'GIFT_CARD'
);

ALTER TABLE "products"
  ADD COLUMN "is_returnable"                  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "non_returnable_reason"          TEXT,
  ADD COLUMN "return_window_days_override"    INTEGER,
  ADD COLUMN "allowed_return_reasons_json"    JSONB,
  ADD COLUMN "allow_partial_return"           BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX "products_is_returnable_idx"
  ON "products" ("is_returnable");

ALTER TABLE "categories"
  ADD COLUMN "default_return_window_days"   INTEGER,
  ADD COLUMN "is_returnable"                BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "default_allowed_reasons_json" JSONB;

ALTER TABLE "order_items"
  ADD COLUMN "item_kind"                            "OrderItemKind" NOT NULL DEFAULT 'PHYSICAL',
  ADD COLUMN "is_returnable_snapshot"               BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "return_window_days_snapshot"          INTEGER,
  ADD COLUMN "allowed_return_reasons_json_snapshot" JSONB,
  ADD COLUMN "allow_partial_return_snapshot"        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "non_returnable_reason_snapshot"       TEXT;

CREATE INDEX "order_items_item_kind_idx"
  ON "order_items" ("item_kind");

ALTER TABLE "returns"
  ADD COLUMN "return_policy_snapshot_json" JSONB;
