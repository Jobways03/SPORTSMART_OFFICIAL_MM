-- Durable DB objects carried from the pre-squash migrations that apply cleanly
-- on the baseline: commission + franchise ledger immutability, trigram search
-- indexes, returns guards + enum fix.
-- DEFERRED to a prod follow-up (reference intermediate column states, need
-- surgery to extract their durable triggers): hash_refresh_tokens_at_rest,
-- order_status_history, einvoice_actor_and_mutation_guard,
-- audit_hash_chain_hardening — see git history (pre-squash commit).

-- Phase 139 — commission history hardening:
--   (1) granular settlements.history.read permission (additive re-seed)
--   (2) append-only enforcement on the three commission-history tables.

-- (1) The history endpoint moves from settlements.read to settlements.history.read
-- (it exposes internal dispute notes/reasons). System roles are handled in the
-- registry; grant the new permission to every CUSTOM role that already holds
-- settlements.read so the split is additive (no lockout under strict guard).
INSERT INTO "admin_custom_role_permissions" ("id", "role_id", "permission_key", "created_at")
SELECT gen_random_uuid(), p."role_id", 'settlements.history.read', NOW()
FROM "admin_custom_role_permissions" p
WHERE p."permission_key" = 'settlements.read'
ON CONFLICT ("role_id", "permission_key") DO NOTHING;

-- (2) Append-only: these tables are written once and never updated by the app
-- (verified — no .update() call sites). A BEFORE UPDATE trigger makes the
-- "edit a historical amount" tamper vector impossible at the DB layer. DELETE is
-- intentionally NOT blocked so parent commission_records cascade deletes (rare,
-- e.g. data-erasure) still work; UPDATE is the audit-integrity concern.
CREATE OR REPLACE FUNCTION reject_commission_history_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commission history is append-only: % on % is not permitted', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER commission_adjustment_history_no_update
  BEFORE UPDATE ON "commission_adjustment_history"
  FOR EACH ROW EXECUTE FUNCTION reject_commission_history_update();

CREATE TRIGGER commission_hold_history_no_update
  BEFORE UPDATE ON "commission_hold_history"
  FOR EACH ROW EXECUTE FUNCTION reject_commission_history_update();

CREATE TRIGGER commission_reversal_records_no_update
  BEFORE UPDATE ON "commission_reversal_records"
  FOR EACH ROW EXECUTE FUNCTION reject_commission_history_update();
-- Phase 159o (2026-05-27) — Franchise Inventory Flow audit #15.
-- The franchise_inventory_ledger is the append-only source of truth for every
-- stock movement (beforeQty/afterQty journal). Application code only ever
-- INSERTs into it, but nothing at the database level *enforced* that — a stray
-- UPDATE/DELETE (buggy migration, manual psql, compromised credential) could
-- silently rewrite inventory history and break reconciliation with no trace.
--
-- These BEFORE UPDATE / BEFORE DELETE row triggers make the table immutable:
-- INSERTs succeed, any row UPDATE or DELETE raises. (TRUNCATE fires a separate
-- trigger class and is intentionally left to privileged maintenance only.)
--
-- Verified before writing this: no code path issues update/delete against this
-- table, and no retention/erasure job purges it — so this is pure defence in
-- depth with no legitimate caller to break.

CREATE OR REPLACE FUNCTION franchise_inventory_ledger_immutable()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'franchise_inventory_ledger is append-only; % is not permitted (row id: %)',
    TG_OP,
    COALESCE(OLD.id, '<unknown>')
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS franchise_inventory_ledger_no_update ON "franchise_inventory_ledger";
DROP TRIGGER IF EXISTS franchise_inventory_ledger_no_delete ON "franchise_inventory_ledger";

CREATE TRIGGER franchise_inventory_ledger_no_update
  BEFORE UPDATE ON "franchise_inventory_ledger"
  FOR EACH ROW EXECUTE FUNCTION franchise_inventory_ledger_immutable();

CREATE TRIGGER franchise_inventory_ledger_no_delete
  BEFORE DELETE ON "franchise_inventory_ledger"
  FOR EACH ROW EXECUTE FUNCTION franchise_inventory_ledger_immutable();
-- Phase 195 (#8) — trigram GIN indexes for storefront search.
--
-- Every public search runs `ILIKE '%term%'` on products.title /
-- short_description / product_code (catalog path) and on brands.name /
-- categories.name (search-module facade). A leading-wildcard ILIKE can't use
-- a B-tree, so each search was a full sequential scan. pg_trgm + GIN turns
-- those into index scans.
--
-- gin_trgm_ops also accelerates the escaped-literal patterns introduced in
-- this phase (#9), since the planner extracts trigrams from the constant.
--
-- CREATE INDEX CONCURRENTLY is NOT used here because Prisma wraps each
-- migration in a transaction (CONCURRENTLY is disallowed inside one). On the
-- current catalog size the plain build is sub-second; for a very large
-- catalog run an out-of-band CONCURRENTLY build instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "products_title_trgm_idx"
  ON "products" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_short_description_trgm_idx"
  ON "products" USING gin ("short_description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_product_code_trgm_idx"
  ON "products" USING gin ("product_code" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "brands_name_trgm_idx"
  ON "brands" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "categories_name_trgm_idx"
  ON "categories" USING gin ("name" gin_trgm_ops);
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
