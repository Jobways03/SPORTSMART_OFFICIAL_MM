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
