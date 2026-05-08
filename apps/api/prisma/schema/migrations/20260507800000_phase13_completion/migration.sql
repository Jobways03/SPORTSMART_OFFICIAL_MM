-- Phase 13 completion — fills the enum gaps from the original spec.
--
-- LiabilityParty originally listed FRANCHISE / BRAND / INCONCLUSIVE
-- among the allowed values; we shipped with the dispute-side
-- subset (NONE / SELLER / LOGISTICS / PLATFORM / CUSTOMER). Adding
-- the missing values now means a franchise- or brand-fault return
-- can be properly attributed instead of falling back to PLATFORM.
-- Additive — existing rows keep their values.

ALTER TYPE "LiabilityParty" ADD VALUE IF NOT EXISTS 'FRANCHISE';
ALTER TYPE "LiabilityParty" ADD VALUE IF NOT EXISTS 'BRAND';
ALTER TYPE "LiabilityParty" ADD VALUE IF NOT EXISTS 'INCONCLUSIVE';
