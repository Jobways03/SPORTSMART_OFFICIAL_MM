-- Phase 133 — support.assign split into finer permissions.
--
-- The admin-support controller used `support.assign` for assignment AND status
-- changes AND priority changes AND category CRUD. It now requires:
--   - support.assign            → assign a ticket to an admin
--   - support.setStatus         → change ticket status
--   - support.setPriority       → change ticket priority
--   - support.categoriesManage  → create / edit / delete categories
--
-- System roles are handled in the registry (SELLER_OPERATIONS gained the three
-- new perms; SUPER_ADMIN holds all). Any CUSTOM role granted support.assign
-- would otherwise lose status/priority/category capability under
-- PERMISSIONS_GUARD_STRICT=true. This re-seed grants those roles the three new
-- permissions so the split is purely additive. Idempotent (ON CONFLICT DO NOTHING).
INSERT INTO "admin_custom_role_permissions" ("id", "role_id", "permission_key", "created_at")
SELECT gen_random_uuid(), p."role_id", v.key, NOW()
FROM "admin_custom_role_permissions" p
CROSS JOIN (
  VALUES ('support.setStatus'), ('support.setPriority'), ('support.categoriesManage')
) AS v(key)
WHERE p."permission_key" = 'support.assign'
ON CONFLICT ("role_id", "permission_key") DO NOTHING;
