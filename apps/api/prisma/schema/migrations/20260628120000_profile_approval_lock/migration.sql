-- Profile approval lock (2026-06-28).
-- Sellers (D2C + Retail) and Franchise partners can fill/submit their profile,
-- but once an admin APPROVES it (verification_status = 'VERIFIED') the profile
-- becomes read-only for self-service: all further changes go through the admin.
--
-- `profile_locked` is a single dedicated flag (NOT derived from
-- verification_status) so an admin can later re-open self-editing by clearing
-- it without de-verifying KYC, and so every seller/franchise self-write path
-- has one source of truth to consult. Default false; NOT NULL (safe additive —
-- Postgres backfills existing rows to false). The backfill UPDATEs then lock
-- every already-approved (VERIFIED) row so the rule takes effect on deploy.
--
-- Set true on approval (ApproveSellerUseCase / franchise verification VERIFIED),
-- false on rejection/reset. The admin-only edit endpoints intentionally ignore
-- this flag.

ALTER TABLE "sellers"
  ADD COLUMN "profile_locked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "franchise_partners"
  ADD COLUMN "profile_locked" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: lock every already-approved profile so existing VERIFIED sellers /
-- franchises become admin-edit-only on deploy (matches new behaviour).
UPDATE "sellers"
  SET "profile_locked" = true
  WHERE "verification_status" = 'VERIFIED';

UPDATE "franchise_partners"
  SET "profile_locked" = true
  WHERE "verification_status" = 'VERIFIED';
