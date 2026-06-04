-- Phase 179 (Top Performers Report audit #16) — internal/demo/test entity flag.
-- Excluded from leaderboards & rankings (getTopSellers / getTopFranchises).
-- Additive, NOT NULL DEFAULT false → zero behaviour change for existing rows.

ALTER TABLE "sellers" ADD COLUMN "is_internal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "franchise_partners" ADD COLUMN "is_internal" BOOLEAN NOT NULL DEFAULT false;
