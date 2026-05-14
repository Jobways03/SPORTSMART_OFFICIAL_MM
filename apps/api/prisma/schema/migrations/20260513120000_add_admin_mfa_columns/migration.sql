-- Backfill missing admin-MFA columns declared on Admin model in admin.prisma
-- (mfaSecretCiphertext, mfaPendingSecretCiphertext, mfaEnabledAt,
--  mfaBackupCodesHashes, mfaLastUsedStep).
--
-- The schema fields existed but no migration created the DB columns, causing
-- P2022 on every admin.findUnique() after `npx prisma generate` produced a
-- client that asked for them by default. All columns are nullable to match
-- the schema (`String?` / `DateTime?` / `Json?` / `Int?`) — no backfill needed.

ALTER TABLE "admins"
  ADD COLUMN "mfa_secret_ciphertext"         TEXT,
  ADD COLUMN "mfa_pending_secret_ciphertext" TEXT,
  ADD COLUMN "mfa_enabled_at"                TIMESTAMP(3),
  ADD COLUMN "mfa_backup_codes_hashes"       JSONB,
  ADD COLUMN "mfa_last_used_step"            INTEGER;
