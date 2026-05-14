-- Sprint 1 Story 0.4 — fix admin MFA schema drift discovered by smoke test.
--
-- The Admin model in prisma/schema/admin.prisma declares 5 MFA columns
-- (mfaSecretCiphertext, mfaPendingSecretCiphertext, mfaEnabledAt,
-- mfaBackupCodesHashes, mfaLastUsedStep). The application code reads them
-- on every admin login (PrismaAdminRepository.findByEmail selects every
-- column on the model). But the live admins table never had them — the
-- migration that should have added them was never authored or committed.
--
-- Symptom: every POST /admin/auth/login returns 500 with Prisma error
-- P2022 ("column admins.mfa_secret_ciphertext does not exist"). Caught
-- by the Sprint 1 / Story 0.4 smoke test on 2026-05-13.
--
-- All 5 columns nullable — admins enrolled before MFA was added have
-- nothing to put in them. The admin-mfa module's enrollment flow
-- populates them on first MFA-enrol.

ALTER TABLE "admins"
  ADD COLUMN "mfa_secret_ciphertext"          TEXT,
  ADD COLUMN "mfa_pending_secret_ciphertext"  TEXT,
  ADD COLUMN "mfa_enabled_at"                 TIMESTAMP(3),
  ADD COLUMN "mfa_backup_codes_hashes"        JSONB,
  ADD COLUMN "mfa_last_used_step"             INTEGER;
