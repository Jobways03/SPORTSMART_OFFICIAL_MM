-- Phase 82 (2026-05-23) — packing & shipping audit Gaps #1/#7/#10/#13.
--
-- 1. Pack/ship audit columns: packed_at / packed_by / shipped_at /
--    shipped_by + tracking_url (Gap #1, #10). actor ids are bare
--    strings (no FK) because the actor can be seller-staff or
--    franchise-staff — no single parent table.
-- 2. Partial unique index on tracking_number (Gap #7). NULLs are
--    allowed in unlimited quantity; non-NULLs must be unique across
--    the table.
-- 3. PARTIALLY_SHIPPED on OrderStatus enum (Gap #13). Adds the
--    mid-shipment master state so the customer view can show
--    "1 of 3 shipped".
-- 4. SLA analytics indexes on (seller_id, packed_at) +
--    (seller_id, shipped_at) and franchise mirrors.
-- 5. Best-effort backfill from updated_at for legacy
--    PACKED/SHIPPED/DELIVERED rows so the SLA dashboard has *some*
--    data the moment the migration lands.

-- ── 1. Pack/ship audit columns + trackingUrl ───────────────────
ALTER TABLE "sub_orders"
  ADD COLUMN "packed_at"     TIMESTAMP(3),
  ADD COLUMN "packed_by"     TEXT,
  ADD COLUMN "shipped_at"    TIMESTAMP(3),
  ADD COLUMN "shipped_by"    TEXT,
  ADD COLUMN "tracking_url"  TEXT;

-- Backfill — best-effort. updated_at is the closest proxy for the
-- actual transition timestamp on legacy rows; new rows write the
-- correct timestamps via the application layer.
UPDATE "sub_orders"
SET "packed_at" = "updated_at"
WHERE "fulfillment_status" IN ('PACKED', 'SHIPPED', 'DELIVERED')
  AND "packed_at" IS NULL;

UPDATE "sub_orders"
SET "shipped_at" = "updated_at"
WHERE "fulfillment_status" IN ('SHIPPED', 'DELIVERED')
  AND "shipped_at" IS NULL;

-- ── 2. Partial unique index on tracking_number ─────────────────
-- Conditional unique so NULLs are unrestricted; legitimate
-- legacy duplicates (if any exist) would fail this migration —
-- callers should clean up before applying.
CREATE UNIQUE INDEX "sub_orders_tracking_number_unique"
  ON "sub_orders" ("tracking_number")
  WHERE "tracking_number" IS NOT NULL;

-- ── 3. PARTIALLY_SHIPPED on OrderStatus ────────────────────────
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_SHIPPED';

-- ── 4. SLA analytics indexes ───────────────────────────────────
CREATE INDEX "sub_orders_seller_id_packed_at_idx"
  ON "sub_orders" ("seller_id", "packed_at");
CREATE INDEX "sub_orders_seller_id_shipped_at_idx"
  ON "sub_orders" ("seller_id", "shipped_at");
CREATE INDEX "sub_orders_franchise_id_packed_at_idx"
  ON "sub_orders" ("franchise_id", "packed_at");
CREATE INDEX "sub_orders_franchise_id_shipped_at_idx"
  ON "sub_orders" ("franchise_id", "shipped_at");
