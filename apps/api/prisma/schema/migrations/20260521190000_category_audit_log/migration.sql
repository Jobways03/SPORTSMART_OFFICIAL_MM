-- Phase 34 (2026-05-21) — Category mutation audit trail.
--
-- Every create / update / delete / deactivate / reorder of a category
-- writes a row here. The previous + new JSON snapshots make
-- post-mortem investigations ("when did this category get
-- deactivated and by whom?") a single indexed query.
--
-- Cascade delete on category drop keeps the table bounded to live
-- categories. If audit retention beyond the category lifetime is
-- ever required, switch the FK to SetNull and add a retention cron.

CREATE TYPE "CategoryAuditAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'DEACTIVATE',
  'REORDER'
);

CREATE TABLE "category_audit_logs" (
  "id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "action" "CategoryAuditAction" NOT NULL,
  "admin_id" TEXT,
  "previous_state" JSONB,
  "new_state" JSONB,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "category_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "category_audit_logs_category_id_created_at_idx"
  ON "category_audit_logs" ("category_id", "created_at");

CREATE INDEX "category_audit_logs_admin_id_created_at_idx"
  ON "category_audit_logs" ("admin_id", "created_at");

ALTER TABLE "category_audit_logs"
  ADD CONSTRAINT "category_audit_logs_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
