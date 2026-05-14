-- Sprint 1 Story 0.4 — second drift discovered by smoke test on 2026-05-13.
--
-- The AdminSession model in prisma/schema/admin.prisma declares a
-- step_up_verified_at column (PR 10.10 — fresh MFA step-up timestamp
-- for the @RequiresStepUp() guard). The application writes it on every
-- session.create(). But the live admin_sessions table never had the
-- column — the matching migration was never authored or committed.
--
-- Symptom: every admin login that gets past findUnique fails on
-- adminSession.create() with Prisma error P2022 ("column
-- admin_sessions.step_up_verified_at does not exist"). Cascading from
-- the MFA-columns drift fixed in 20260513100000.
--
-- Nullable — sessions established before MFA step-up was required have
-- nothing to populate it with. The guard treats null as "needs fresh
-- step-up", which matches the intended semantics for legacy sessions.

ALTER TABLE "admin_sessions"
  ADD COLUMN "step_up_verified_at" TIMESTAMP(3);
