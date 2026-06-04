-- Phase 199 (2026-06-02) — Returns Flow audit #5.
-- Defense-in-depth DB guard for rule R1: "one ACTIVE return per
-- orderItemId" (CaseDuplicateService R1).
--
-- The app already enforces this two ways:
--   1. CaseDuplicateService.assertNoActiveReturnForOrderItem (flag now
--      defaults ON — CASE_DUPLICATE_PREVENTION_ENABLED='true').
--   2. PrismaReturnRepository.create() takes SELECT ... FOR UPDATE on the
--      order_items rows and re-checks for an active duplicate under the
--      lock before inserting.
--
-- This migration adds a third, schema-level backstop so the invariant
-- holds even for any future write path that bypasses the service (admin
-- tools, data imports, a refactor that forgets the recheck).
--
-- "Active" = the parent return is NOT in a terminal status
-- (CANCELLED / REJECTED / COMPLETED / REFUNDED). A plain partial-unique
-- index cannot express this because the predicate lives on `returns`
-- while the key (order_item_id) lives on `return_items` — Postgres
-- partial indexes can only reference columns of the indexed table. We
-- therefore enforce it with a constraint trigger that fires on
-- return_items INSERT and on returns.status transitions back into an
-- active state.
--
-- The trigger is intentionally NOT retroactive: it only validates rows
-- as they are written, so it can be deployed against existing data that
-- may already contain (pre-fix) duplicates without failing the
-- migration. Existing duplicates, if any, are left for an operational
-- cleanup; new ones are blocked.

-- ── helper: is a given status "active" for return-duplicate purposes ──
CREATE OR REPLACE FUNCTION returns_status_is_active(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status NOT IN ('CANCELLED', 'REJECTED', 'COMPLETED', 'REFUNDED');
$$;

-- ── guard fired when a return_item row is inserted ───────────────────
CREATE OR REPLACE FUNCTION returns_assert_no_active_dup_on_item_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_status text;
  v_dup_number    text;
BEGIN
  -- Status of the return this new item belongs to.
  SELECT r.status INTO v_parent_status
  FROM returns r
  WHERE r.id = NEW.return_id;

  -- Only enforce when the new item's parent return is itself active.
  IF v_parent_status IS NULL OR NOT returns_status_is_active(v_parent_status) THEN
    RETURN NEW;
  END IF;

  -- Is there ANOTHER active return already covering this order_item?
  SELECT r2.return_number INTO v_dup_number
  FROM return_items ri2
  JOIN returns r2 ON r2.id = ri2.return_id
  WHERE ri2.order_item_id = NEW.order_item_id
    AND ri2.return_id <> NEW.return_id
    AND returns_status_is_active(r2.status)
  LIMIT 1;

  IF v_dup_number IS NOT NULL THEN
    RAISE EXCEPTION
      'An active return (%) already exists for order_item %',
      v_dup_number, NEW.order_item_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_items_no_active_dup ON return_items;
CREATE TRIGGER trg_return_items_no_active_dup
  BEFORE INSERT ON return_items
  FOR EACH ROW
  EXECUTE FUNCTION returns_assert_no_active_dup_on_item_insert();

-- ── guard fired when a return is (re)activated via a status change ────
-- Covers the edge case where a terminal return is moved back into an
-- active status (e.g. a reopen) while another active return now covers
-- the same item. Only runs on an inactive→active transition so normal
-- forward progress (REQUESTED→APPROVED→…) is unaffected.
CREATE OR REPLACE FUNCTION returns_assert_no_active_dup_on_reactivate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_dup_number text;
BEGIN
  IF returns_status_is_active(OLD.status) OR NOT returns_status_is_active(NEW.status) THEN
    -- Not an inactive→active transition; nothing to check.
    RETURN NEW;
  END IF;

  SELECT r2.return_number INTO v_dup_number
  FROM return_items ri_self
  JOIN return_items ri2 ON ri2.order_item_id = ri_self.order_item_id
  JOIN returns r2 ON r2.id = ri2.return_id
  WHERE ri_self.return_id = NEW.id
    AND ri2.return_id <> NEW.id
    AND returns_status_is_active(r2.status)
  LIMIT 1;

  IF v_dup_number IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot reactivate return %: another active return (%) already covers one of its items',
      NEW.return_number, v_dup_number
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_returns_no_active_dup_reactivate ON returns;
CREATE TRIGGER trg_returns_no_active_dup_reactivate
  BEFORE UPDATE OF status ON returns
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION returns_assert_no_active_dup_on_reactivate();
