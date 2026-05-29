-- Phase 69 (2026-05-22) — Phase 67 audit Gaps #17 + #18.
--
-- Replace the single-row `order_sequence` upsert (which serialised
-- every concurrent order create on one row lock) with a real
-- Postgres SEQUENCE. nextval() is non-transactional, lock-free, and
-- monotonically increasing — exactly what the order-numbering
-- contract needs.
--
-- Pre-Phase-69 the upsert in placeOrderTransaction held a row lock
-- inside the order tx; at 50+ orders/s the lock queue grew and 99p
-- latency degraded. The new path:
--   1. Repo calls SELECT nextval('order_number_seq') inside the tx
--      (cheap; no row contention; no rollback effect — sequences
--      don't honour transaction boundaries by design, but that's
--      OK because we only consume the value when masterOrder.create
--      succeeds).
--   2. The legacy `order_sequence` table is kept for backward
--      compatibility (rolling deploy + the legacy
--      legacyPlaceOrderTransaction path still reads it). A
--      follow-up phase drops the table once all callers migrate.

-- Create the sequence. start_value = current order_sequence.last_number
-- (or 1 if the row doesn't exist yet). MAXVALUE is the default (~9 EB);
-- we won't hit it in any realistic timeline.
DO $$
DECLARE
  current_last INTEGER;
BEGIN
  SELECT COALESCE(MAX(last_number), 0) + 1 INTO current_last FROM order_sequence;
  IF current_last < 1 THEN
    current_last := 1;
  END IF;
  -- CREATE SEQUENCE IF NOT EXISTS is single-statement only; can't
  -- combine with dynamic start_value, so we build the DDL string.
  EXECUTE format(
    'CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH %s INCREMENT BY 1 CACHE 20',
    current_last
  );
END $$;
