-- Brute-force guard for customer login — parity with the Seller /
-- Franchise / Admin login flows, which already have these columns.
-- Without this migration, LoginUserUseCase's failed-attempt bookkeeping
-- hits Prisma P2022 ("column users.failed_login_attempts does not
-- exist") and the entire /auth/login endpoint 500s before a single
-- credential check runs.

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lock_until" TIMESTAMP(3);
