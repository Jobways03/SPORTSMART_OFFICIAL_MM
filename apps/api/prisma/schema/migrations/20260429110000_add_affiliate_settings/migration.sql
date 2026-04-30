-- CreateTable
CREATE TABLE "affiliate_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "default_commission_percentage" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "minimum_payout_amount" DECIMAL(10,2) NOT NULL DEFAULT 500,
    "return_window_days" INTEGER NOT NULL DEFAULT 7,
    "tds_rate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "tds_threshold_per_fy" DECIMAL(12,2) NOT NULL DEFAULT 15000,
    "commission_reversal_window_days" INTEGER NOT NULL DEFAULT 30,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_settings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row so the very first GET succeeds without an
-- upsert race. The service still upserts defensively, but seeding
-- means staging/prod have a baseline immediately after migration.
INSERT INTO "affiliate_settings" ("id", "updated_at") VALUES ('singleton', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
