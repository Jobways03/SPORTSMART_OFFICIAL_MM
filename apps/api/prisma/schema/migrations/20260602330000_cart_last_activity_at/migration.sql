-- Phase 196 (#11) — explicit cart activity timestamp.
--
-- Cart.updatedAt only bumps on a direct Cart-row write (which, pre-196, only
-- happened on add via upsertCart). Item update/remove/clear didn't touch it,
-- so it was an unreliable "last activity" signal for the abandonment sweep.
-- last_activity_at is stamped by the service on every cart mutation.
--
-- Backfill existing rows from updated_at so the new column starts with a
-- sensible value rather than "now" for every historical cart.

ALTER TABLE "carts"
  ADD COLUMN "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "carts" SET "last_activity_at" = "updated_at";

CREATE INDEX "carts_last_activity_at_idx" ON "carts" ("last_activity_at");
