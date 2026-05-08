-- ============================================
-- Phase 7 (PR 7.1) — File integrity hash columns
-- ============================================
-- Existing rows get NULL on every new column. Backfill handled by the
-- integrity-verifier cron landing in PR 7.5 — it picks the oldest
-- unverified file first and walks forward, so old uploads converge to
-- a hashed state without a one-shot batch job.

ALTER TABLE "file_metadata"
    ADD COLUMN "content_sha256"   TEXT,
    ADD COLUMN "hash_algorithm"   TEXT      DEFAULT 'sha256',
    ADD COLUMN "hashed_at"        TIMESTAMP(3),
    ADD COLUMN "last_verified_at" TIMESTAMP(3);

CREATE INDEX "file_metadata_status_last_verified_at_idx"
    ON "file_metadata" ("status", "last_verified_at");
