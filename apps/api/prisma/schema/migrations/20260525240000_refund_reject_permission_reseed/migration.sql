-- Phase 132 — refund approve/reject separation of duties.
--
-- The finance approvals controller used to require `refunds.approve` for ALL
-- routes (view, approve, reject). It now requires:
--   - refunds.read   → list + get (view the queue)
--   - refunds.approve→ approve
--   - refunds.reject → reject
--
-- System roles are unaffected (only SUPER_ADMIN held refunds.approve, and it
-- holds every permission). But any CUSTOM role that was granted refunds.approve
-- would lose view + reject access under PERMISSIONS_GUARD_STRICT=true. This
-- re-seed grants those roles the two new finer permissions so capability is
-- preserved — the split is purely additive. Idempotent (ON CONFLICT DO NOTHING).
INSERT INTO "admin_custom_role_permissions" ("id", "role_id", "permission_key", "created_at")
SELECT gen_random_uuid(), p."role_id", 'refunds.read', NOW()
FROM "admin_custom_role_permissions" p
WHERE p."permission_key" = 'refunds.approve'
ON CONFLICT ("role_id", "permission_key") DO NOTHING;

INSERT INTO "admin_custom_role_permissions" ("id", "role_id", "permission_key", "created_at")
SELECT gen_random_uuid(), p."role_id", 'refunds.reject', NOW()
FROM "admin_custom_role_permissions" p
WHERE p."permission_key" = 'refunds.approve'
ON CONFLICT ("role_id", "permission_key") DO NOTHING;
