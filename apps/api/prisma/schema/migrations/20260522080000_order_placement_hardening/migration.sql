-- Phase 67 (2026-05-22) — Order Placement Flow hardening.
-- Closes audit gaps #3 (idempotency), #9 (source cart linkage),
-- #10 (order-item ↔ stock reservation linkage), #23 (image public
-- id), and the order-finalisation tracking (Gaps #1 + #5).

-- ── MasterOrder ────────────────────────────────────────────────
-- Audit Gap #3 — deterministic idempotency key + partial unique
-- index. Application code derives the key as sha-256(customerId|
-- session.createdAt) so a retried place-order POST resolves to
-- the same row even when the @Idempotent decorator's TTL cache
-- has been bypassed (different replica, cleared cache, missing
-- X-Idempotency-Key). The column is nullable so legacy rows
-- without a key remain valid; the partial unique index allows
-- many NULL rows but enforces uniqueness for any populated key.
ALTER TABLE "master_orders"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "source_cart_id" TEXT,
  ADD COLUMN IF NOT EXISTS "finalized_at" TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "master_orders_idempotency_key_unique"
  ON "master_orders" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- Index for the finalisation-recovery cron: WHERE finalized_at IS
-- NULL AND created_at < NOW() - interval '5 minutes'. Without this
-- the cron scans every MasterOrder. Partial index keeps it tiny
-- in steady state.
CREATE INDEX IF NOT EXISTS "master_orders_pending_finalisation_idx"
  ON "master_orders" ("created_at")
  WHERE "finalized_at" IS NULL;

-- ── OrderItem ──────────────────────────────────────────────────
-- Audit Gap #10 — direct FK-style id pointer so refund-by-item
-- doesn't have to query (productId, variantId, mappingId).
-- Audit Gap #23 — Cloudinary public id snapshot for URL rebuild.
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "stock_reservation_id" TEXT,
  ADD COLUMN IF NOT EXISTS "image_public_id" TEXT;

-- Index so the per-reservation lookup in stock-restore / refund
-- flows is O(log n) rather than a scan over order_items.
CREATE INDEX IF NOT EXISTS "order_items_stock_reservation_id_idx"
  ON "order_items" ("stock_reservation_id")
  WHERE "stock_reservation_id" IS NOT NULL;
