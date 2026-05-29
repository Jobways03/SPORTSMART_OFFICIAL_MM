-- Phase 134 — disputes.internalNote split from disputes.reply.
--
-- Posting an internal (admin-only) note now needs `disputes.internalNote`,
-- which used to be implicitly allowed by `disputes.reply`. System roles are
-- handled in the registry (SELLER_OPERATIONS granted; SUPER_ADMIN holds all).
-- Grant internalNote to any CUSTOM role that holds disputes.reply so the split
-- is purely additive — no lockout under PERMISSIONS_GUARD_STRICT=true. Idempotent.
--
-- NOTE: `disputes.decide.high_value` is intentionally NOT re-seeded here. It is
-- a deliberate RESTRICTION on high-value decisions (only SUPER_ADMIN holds it by
-- default); grant it explicitly to whichever roles should have that authority.
INSERT INTO "admin_custom_role_permissions" ("id", "role_id", "permission_key", "created_at")
SELECT gen_random_uuid(), p."role_id", 'disputes.internalNote', NOW()
FROM "admin_custom_role_permissions" p
WHERE p."permission_key" = 'disputes.reply'
ON CONFLICT ("role_id", "permission_key") DO NOTHING;
