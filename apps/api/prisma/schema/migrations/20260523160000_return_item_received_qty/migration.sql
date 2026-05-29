-- Phase 100 (2026-05-23) — Mark Received audit Gap #17 closure.
--
-- Per-item received quantity + condition so ops can distinguish
-- "received 2 of 3 items in the box" from "all items received."
-- Nullable for legacy rows; QC defaults to original quantity when
-- still null at QC submission time.

ALTER TABLE "return_items"
  ADD COLUMN "received_qty"       INTEGER,
  ADD COLUMN "received_condition" TEXT;
