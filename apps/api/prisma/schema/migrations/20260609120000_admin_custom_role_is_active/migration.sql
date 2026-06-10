-- Enable/disable for admin custom roles (Phase: roles enable/disable feature).
-- A disabled role keeps its permissions + assignments but grants NOTHING at
-- resolve time — the admin permission resolver skips inactive roles. Defaults
-- to true so every existing role stays active after the migration.
ALTER TABLE "admin_custom_roles"
  ADD COLUMN "is_active" boolean NOT NULL DEFAULT true;

CREATE INDEX "admin_custom_roles_is_active_idx"
  ON "admin_custom_roles" ("is_active");
