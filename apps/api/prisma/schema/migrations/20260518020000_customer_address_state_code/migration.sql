-- Phase 34 (2026-05-18) — canonical GST state code on customer_addresses.
--
-- The `state` column stays as free-text for UI display. The new
-- `state_code` column carries the canonical CBIC 2-digit GST code
-- that the tax engine + place-of-supply resolver reads. This avoids
-- the runtime name-lookup hack in tax/domain/state-code-map.ts —
-- writes now persist the code at the source, reads consume it
-- directly.
--
-- Strategy:
--   1. Add the nullable column (existing rows stay legal).
--   2. Backfill from india_states by case-insensitive name match.
--      A row whose free-text `state` doesn't match any india_states
--      row exactly stays NULL — the legacy state-code-map fallback
--      will still resolve it at request time, and ops can patch
--      via a one-off UPDATE.
--   3. Index by state_code for the GSTR-1 / place-of-supply
--      aggregation queries.
--
-- Rollback: DROP COLUMN state_code is safe — no code requires it
-- on read (tax module falls back to the name lookup).

ALTER TABLE "customer_addresses"
    ADD COLUMN "state_code" TEXT;

-- Backfill via case-insensitive name match. UPPER + TRIM normalises
-- the bulk of legacy data ("Karnataka", "karnataka", "KARNATAKA",
-- "  Karnataka "). Multi-word states ("Tamil Nadu", "Andhra
-- Pradesh") match because india_states stores them spaced.
UPDATE "customer_addresses" ca
SET "state_code" = (
    SELECT "gst_state_code"
    FROM "india_states" s
    WHERE UPPER(TRIM(s."state_name")) = UPPER(TRIM(ca."state"))
      AND s."is_active" = TRUE
    LIMIT 1
)
WHERE "state_code" IS NULL;

-- Index for the GSTR-1 outward-supply rollup and place-of-supply
-- queries that filter by state_code.
CREATE INDEX "customer_addresses_state_code_idx"
    ON "customer_addresses" ("state_code");
