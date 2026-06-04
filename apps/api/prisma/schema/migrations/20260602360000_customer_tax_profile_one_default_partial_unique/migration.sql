-- Phase 200 (Customer Tax Profile audit #7) — DB-level "at most one default
-- per customer" guarantee.
--
-- CustomerTaxProfileService.create / update / setDefault already serialise the
-- unset-then-set inside a single $transaction, so the application path keeps
-- exactly one is_default=true row per customer. This PARTIAL unique index is
-- the backstop: it makes a concurrent two-default race (two requests racing the
-- read-then-write window across separate connections) impossible at the storage
-- layer — the second writer hits P2002 instead of silently producing a second
-- default that would make invoice-type detection (B2B vs B2C) ambiguous.
--
-- Prisma can NOT express a WHERE-partial unique, so it is raw SQL here and is
-- documented inline on the model (@@index comment in tax-master.prisma).
--
-- IMPORTANT — pre-flight on existing data.
-- This CREATE UNIQUE INDEX FAILS if any customer already has >1 default row.
-- That is the correct behaviour: deploy fails loudly so ops dedupes BEFORE the
-- constraint locks future writes. To find offenders ahead of deploy:
--
--   SELECT customer_id, count(*)
--   FROM customer_tax_profiles
--   WHERE is_default = true
--   GROUP BY customer_id
--   HAVING count(*) > 1;
--
-- Remediation: keep the most-recently-updated default, set the rest to false.
-- A defensive auto-dedupe is included below (idempotent, safe to re-run): it
-- demotes all-but-the-newest default per customer before the index is built.

-- Defensive de-dupe: keep the newest default per customer, demote the rest.
UPDATE "customer_tax_profiles" AS c
SET "is_default" = false
WHERE "is_default" = true
  AND "id" <> (
    SELECT "id" FROM "customer_tax_profiles" AS d
    WHERE d."customer_id" = c."customer_id" AND d."is_default" = true
    ORDER BY d."updated_at" DESC, d."created_at" DESC, d."id" DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX "customer_tax_profiles_one_default_per_customer_uniq"
  ON "customer_tax_profiles" ("customer_id")
  WHERE "is_default" = true;
