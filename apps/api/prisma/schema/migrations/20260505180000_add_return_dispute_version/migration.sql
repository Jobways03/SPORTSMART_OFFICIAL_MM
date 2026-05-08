-- ============================================
-- Phase 5 (PRs 5.1 + 5.2) — version columns for FSM optimistic locking
-- ============================================
-- A `version` counter on Return + Dispute lets concurrent writers do a
-- compare-and-set update; a stale CAS surfaces as a 409 instead of
-- silently overwriting fresh state. Default 0 for existing rows so
-- newly-deployed code reads version=0 on records that pre-date the
-- migration — those rows still update fine, they just start the
-- optimistic-lock window from zero.

ALTER TABLE "returns"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "disputes"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
