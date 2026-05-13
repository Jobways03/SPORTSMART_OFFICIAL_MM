-- Phase 3 (PR 3.6) — refresh-token reuse detection.
--
-- Adds a nullable `previous_refresh_token_hash` slot on `sessions`.
-- On every rotation the application stashes the current
-- `refresh_token` hash into this column BEFORE overwriting the
-- current with the new hash. A subsequent refresh request that
-- hashes to the previous slot (and not the current one) means a
-- burned token is being replayed → all sessions for that user get
-- revoked.
--
-- Nullable so existing rows backfill cleanly; the next rotation
-- stamps the column for each session organically. No backfill
-- required.
--
-- The index supports the secondary-lookup path the use-case takes
-- only when the primary refresh-token match misses, so it sees low
-- traffic but high cardinality.

ALTER TABLE "sessions"
  ADD COLUMN "previous_refresh_token_hash" TEXT;

CREATE INDEX "sessions_previous_refresh_token_hash_idx"
  ON "sessions" ("previous_refresh_token_hash");
