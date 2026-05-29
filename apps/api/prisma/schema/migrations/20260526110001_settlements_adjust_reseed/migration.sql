-- Phase 147 — the adjustment endpoints move from the shared settlements.approve
-- to a granular settlements.adjust. System roles are handled in the registry;
-- grant the new permission to any CUSTOM role holding settlements.approve so the
-- split is additive (no lockout under PERMISSIONS_GUARD_STRICT=true).
INSERT INTO "admin_custom_role_permissions" ("id", "role_id", "permission_key", "created_at")
SELECT gen_random_uuid(), p."role_id", 'settlements.adjust', NOW()
FROM "admin_custom_role_permissions" p
WHERE p."permission_key" = 'settlements.approve'
ON CONFLICT ("role_id", "permission_key") DO NOTHING;
