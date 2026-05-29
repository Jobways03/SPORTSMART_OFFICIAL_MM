-- Phase 153 (2026-05-26) — Per-Batch CSV Export audit.
-- Optional per-seller payout-rail preference (UPI / IMPS / NEFT). The bank
-- export honours it when the amount is valid for that rail, else falls back to
-- amount-based routing.
ALTER TABLE "seller_bank_details" ADD COLUMN IF NOT EXISTS "preferred_payout_method" VARCHAR(8);
