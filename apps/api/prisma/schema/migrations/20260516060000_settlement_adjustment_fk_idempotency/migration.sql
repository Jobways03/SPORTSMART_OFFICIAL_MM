-- Phase 12 (2026-05-16) — SettlementAdjustment schema integrity.
--
-- Two fixes the audit flagged for SettlementAdjustment:
--
--   1. The `settlement_id` column was a bare String — no FK to
--      seller_settlements. Orphaned rows accumulated whenever a
--      settlement was deleted. Add the constraint with
--      ON DELETE CASCADE so dependent adjustments go away with the
--      parent (matches the semantic of the in-application service).
--
--   2. No dedup at the DB layer. A retried admin POST could insert
--      the same adjustment twice. Add an `idempotency_key` column +
--      partial UNIQUE INDEX scoped to non-null keys so existing rows
--      (which predate the key) don't fail the constraint.
--
-- Pre-flight safety: orphan-row backfill. Any row whose
-- settlement_id doesn't resolve to a settlement is hard-deleted
-- before the FK is created — without this, ADD CONSTRAINT would
-- fail. The orphan count is logged so the operator has a record of
-- what was cleaned up; on a healthy DB this should be 0.

-- 1. Backfill: log + delete orphan rows.
DO $$
DECLARE
    orphan_count INT;
BEGIN
    SELECT COUNT(*) INTO orphan_count
      FROM settlement_adjustments sa
     WHERE NOT EXISTS (
        SELECT 1 FROM seller_settlements s
         WHERE s.id = sa.settlement_id
     );
    IF orphan_count > 0 THEN
        RAISE NOTICE 'Deleting % orphan settlement_adjustments rows before adding FK', orphan_count;
        DELETE FROM settlement_adjustments sa
         WHERE NOT EXISTS (
            SELECT 1 FROM seller_settlements s
             WHERE s.id = sa.settlement_id
         );
    END IF;
END $$;

-- 2. Add the idempotency_key column (nullable for backward compat).
ALTER TABLE "settlement_adjustments"
    ADD COLUMN "idempotency_key" TEXT;

-- 3. Add the FK to seller_settlements.
ALTER TABLE "settlement_adjustments"
    ADD CONSTRAINT "settlement_adjustments_settlement_id_fkey"
    FOREIGN KEY ("settlement_id")
    REFERENCES "seller_settlements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Partial unique on (settlement_id, idempotency_key) — only
--    enforced when idempotency_key IS NOT NULL. Legacy rows with
--    NULL keys can coexist; new posts with a key collapse.
CREATE UNIQUE INDEX "settlement_adjustments_idem_unique"
    ON "settlement_adjustments" ("settlement_id", "idempotency_key")
 WHERE "idempotency_key" IS NOT NULL;
