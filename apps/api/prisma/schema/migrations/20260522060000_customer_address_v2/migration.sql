-- Phase 63 (2026-05-22) — customer-address hardening.
--
-- 1) AddressType enum + addressType column (audit Gap #6).
--    Optional so existing rows stay valid; the storefront prompts
--    for it on new saves.
CREATE TYPE "AddressType" AS ENUM ('HOME', 'WORK', 'OTHER');

ALTER TABLE "customer_addresses"
  ADD COLUMN "landmark" TEXT,
  ADD COLUMN "address_type" "AddressType",
  ADD COLUMN "deleted_at" TIMESTAMP(3);

-- 2) deleted_at index supports the list query's NULL filter
--    (audit Gap #3 backstop).
CREATE INDEX "customer_addresses_deleted_at_idx"
  ON "customer_addresses"("deleted_at");

-- 3) Partial unique index — DB-level enforcement of the one-
--    default-per-customer invariant (audit Gap #1). Catches any
--    write that bypasses the service's $transaction (raw SQL,
--    future code path that forgets to wrap the clear+create).
--    Index is partial so the WHERE clause keeps it tight: it
--    only enforces uniqueness among LIVE (deleted_at IS NULL)
--    rows where is_default = TRUE — so a soft-deleted previously-
--    default row doesn't block a new default.
CREATE UNIQUE INDEX "customer_addresses_one_default_per_customer"
  ON "customer_addresses"("customer_id")
  WHERE "is_default" = TRUE AND "deleted_at" IS NULL;
