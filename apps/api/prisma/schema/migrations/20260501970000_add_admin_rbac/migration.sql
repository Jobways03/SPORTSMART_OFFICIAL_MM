CREATE TABLE "admin_custom_roles" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "admin_custom_role_permissions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "role_id" TEXT NOT NULL,
  "permission_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_custom_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_custom_roles"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "admin_custom_role_permissions_role_id_permission_key_key" ON "admin_custom_role_permissions"("role_id", "permission_key");
CREATE INDEX "admin_custom_role_permissions_permission_key_idx" ON "admin_custom_role_permissions"("permission_key");

CREATE TABLE "admin_role_assignments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "admin_id" TEXT NOT NULL,
  "role_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_custom_roles"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "admin_role_assignments_admin_id_role_id_key" ON "admin_role_assignments"("admin_id", "role_id");
CREATE INDEX "admin_role_assignments_admin_id_idx" ON "admin_role_assignments"("admin_id");
