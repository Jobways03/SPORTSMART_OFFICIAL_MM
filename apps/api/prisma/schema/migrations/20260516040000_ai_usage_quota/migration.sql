-- Phase 7 (2026-05-16) — Per-tenant AI usage quota.

CREATE TABLE "ai_usage_quotas" (
    "id"           TEXT NOT NULL,
    "subject"      TEXT NOT NULL,
    "subject_type" TEXT,
    "provider"     TEXT NOT NULL,
    "day"          TIMESTAMP(3) NOT NULL,
    "call_count"   INTEGER NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_quotas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usage_quota_unique"
    ON "ai_usage_quotas"("subject", "day", "provider");
CREATE INDEX "ai_usage_quotas_subject_day_idx"
    ON "ai_usage_quotas"("subject", "day");
CREATE INDEX "ai_usage_quotas_day_idx"
    ON "ai_usage_quotas"("day");
