-- Fix: the per-order-item active-return guard trigger functions
-- (added in 20260602350000_returns_active_per_orderitem_guard) call the
-- helper `returns_status_is_active(text)` while passing the `status`
-- column directly, which is the `"ReturnStatus"` ENUM. PostgreSQL has no
-- IMPLICIT enum->text cast for function-argument resolution, so the call
-- failed at runtime with:
--   42883: function returns_status_is_active("ReturnStatus") does not exist
-- The trigger fires on EVERY return_items INSERT whose parent return is
-- active, so this broke ALL return creation (customer + admin) since the
-- guard migration shipped. Re-create both trigger functions with an
-- explicit `::text` cast at every enum call site. Triggers reference the
-- functions by name, so CREATE OR REPLACE is sufficient — no trigger
-- recreate needed. The helper signature and trigger definitions are
-- unchanged.

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
    AND returns_status_is_active(r2.status::text)
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

-- ── guard fired when a return is (re)activated via a status change ────
CREATE OR REPLACE FUNCTION returns_assert_no_active_dup_on_reactivate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_dup_number text;
BEGIN
  IF returns_status_is_active(OLD.status::text) OR NOT returns_status_is_active(NEW.status::text) THEN
    -- Not an inactive->active transition; nothing to check.
    RETURN NEW;
  END IF;

  SELECT r2.return_number INTO v_dup_number
  FROM return_items ri_self
  JOIN return_items ri2 ON ri2.order_item_id = ri_self.order_item_id
  JOIN returns r2 ON r2.id = ri2.return_id
  WHERE ri_self.return_id = NEW.id
    AND ri2.return_id <> NEW.id
    AND returns_status_is_active(r2.status::text)
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
