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
