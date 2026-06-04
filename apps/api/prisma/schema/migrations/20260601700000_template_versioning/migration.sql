-- Phase 188 — Template Editor + Preview flow audit remediation.
--
-- #4  versioning + history (NotificationTemplateHistory)
-- #6  createdByAdminId / updatedByAdminId on the template
-- #9  Postgres CHECK backstop on body size (DTO also caps at the app layer)

ALTER TABLE "notification_templates"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "created_by_admin_id" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_by_admin_id" TEXT;

-- (#9) Hard backstop on body size — generous 200 KB ceiling (the DTO caps
-- tighter at 100k chars). NOT VALID so existing rows aren't retro-checked.
ALTER TABLE "notification_templates"
  DROP CONSTRAINT IF EXISTS "notification_templates_body_size_chk";
ALTER TABLE "notification_templates"
  ADD CONSTRAINT "notification_templates_body_size_chk"
  CHECK (octet_length("body") < 200000) NOT VALID;

-- (#4) Per-version snapshot table.
CREATE TABLE IF NOT EXISTS "notification_template_history" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "template_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL,
  "change_type" TEXT NOT NULL,
  "changed_by_admin_id" TEXT,
  "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_template_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notification_template_history_template_id_changed_at_idx"
  ON "notification_template_history" ("template_id", "changed_at" DESC);
CREATE INDEX IF NOT EXISTS "notification_template_history_template_key_version_idx"
  ON "notification_template_history" ("template_key", "version");

ALTER TABLE "notification_template_history"
  ADD CONSTRAINT "notification_template_history_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
