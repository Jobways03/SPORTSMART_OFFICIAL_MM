-- Phase 52 (2026-05-21) — stock_reservations hardening.

CREATE TYPE "StockReservationStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'RELEASED', 'EXPIRED');

-- Lock-step cast: existing TEXT rows map 1:1 to the new enum.
ALTER TABLE "stock_reservations"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "StockReservationStatus"
    USING "status"::"StockReservationStatus",
  ALTER COLUMN "status" SET DEFAULT 'RESERVED';

ALTER TABLE "stock_reservations"
  ADD COLUMN "customer_id" TEXT,
  ADD COLUMN "session_id" TEXT,
  ADD COLUMN "cart_id" TEXT,
  ADD COLUMN "expired_at" TIMESTAMP(3),
  ADD COLUMN "released_at" TIMESTAMP(3),
  ADD COLUMN "confirmed_at" TIMESTAMP(3);

CREATE INDEX "stock_reservations_customer_id_idx" ON "stock_reservations" ("customer_id");
CREATE INDEX "stock_reservations_order_id_idx" ON "stock_reservations" ("order_id");
