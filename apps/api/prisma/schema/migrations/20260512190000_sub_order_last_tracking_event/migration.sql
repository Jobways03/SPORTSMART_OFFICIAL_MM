-- Phase 4 (PR 4.4) — sub-order tracking-event ordering guard.
--
-- Adds a nullable `last_tracking_event_at` slot per sub-order. The
-- Shiprocket and iThink webhook handlers stamp it with the event-side
-- timestamp on every accepted event; a subsequent incoming event whose
-- timestamp is OLDER than the stored value is dropped as out-of-order.
-- Without this, a DELIVERED webhook arriving before an IN_TRANSIT (due
-- to Shiprocket's at-least-once delivery + reorder under load) would
-- complete the FSM, then the late IN_TRANSIT would regress it.
--
-- Nullable for back-compat: existing rows have no recorded event yet,
-- and the first incoming event passes the "null → store" branch of the
-- CAS predicate trivially.

ALTER TABLE "sub_orders"
  ADD COLUMN "last_tracking_event_at" TIMESTAMP(3);
