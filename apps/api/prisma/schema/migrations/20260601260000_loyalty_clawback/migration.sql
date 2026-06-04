-- Phase 182 (make-it-100%) — loyalty clawback tracking.
ALTER TABLE "loyalty_earn_events"
  ADD COLUMN "clawed_back_in_paise" BIGINT NOT NULL DEFAULT 0;
