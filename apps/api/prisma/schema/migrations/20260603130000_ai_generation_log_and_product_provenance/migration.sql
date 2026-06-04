-- Phase 249 — AI generation log + Product AI-provenance. Additive.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiGenerationStatus') THEN
    CREATE TYPE "AiGenerationStatus" AS ENUM ('GENERATED', 'ACCEPTED', 'DISCARDED', 'FAILED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "ai_generation_logs" (
  "id" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "subject_type" TEXT,
  "product_id" TEXT,
  "title_hint" TEXT,
  "category_hint" TEXT,
  "brand_hint" TEXT,
  "prompt_version" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "generated_json" JSONB,
  "status" "AiGenerationStatus" NOT NULL DEFAULT 'GENERATED',
  "duration_ms" INTEGER,
  "error_message" TEXT,
  "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_generation_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_generation_logs_subject_created_at_idx" ON "ai_generation_logs" ("subject", "created_at");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_product_id_idx" ON "ai_generation_logs" ("product_id");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_status_created_at_idx" ON "ai_generation_logs" ("status", "created_at");

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "ai_generated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ai_generated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ai_prompt_version" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_human_reviewed" BOOLEAN NOT NULL DEFAULT false;
