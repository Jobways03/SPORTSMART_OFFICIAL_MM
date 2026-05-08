-- Roles can now be disabled without being deleted. While disabled, the role
-- contributes no permissions to its assigned admins, but assignments are
-- preserved so the role can be re-enabled later without re-assigning members.
ALTER TABLE "admin_custom_roles"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
