-- ============================================
-- Phase 11 (post-redesign feature) — SHIPMENT_EVIDENCE FilePurpose
-- ============================================
-- Adds a new enum value so sellers can upload "proof of dispatch"
-- photos at packing time. These photos give the admin returns flow
-- an as-shipped baseline to compare against any subsequent customer
-- "damaged in transit" claim.
--
-- ALTER TYPE ADD VALUE doesn't run inside a transaction in Postgres
-- so this migration sits alone (Prisma handles that automatically).

ALTER TYPE "FilePurpose" ADD VALUE 'SHIPMENT_EVIDENCE';
