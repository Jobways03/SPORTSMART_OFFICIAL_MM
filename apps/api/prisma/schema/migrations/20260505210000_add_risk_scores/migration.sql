-- ============================================
-- Phase 6 (PR 6.3) — Risk scoring
-- ============================================

CREATE TYPE "RiskTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "risk_scores" (
    "id"              TEXT         NOT NULL,
    "resource_type"   TEXT         NOT NULL,
    "resource_id"     TEXT         NOT NULL,
    "score"           INTEGER      NOT NULL,
    "tier"            "RiskTier"   NOT NULL,
    "signals"         JSONB        NOT NULL,
    "version"         INTEGER      NOT NULL DEFAULT 0,
    "computed_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "risk_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "risk_scores_resource_type_resource_id_key"
    ON "risk_scores" ("resource_type", "resource_id");

CREATE INDEX "risk_scores_resource_type_score_idx"
    ON "risk_scores" ("resource_type", "score");

CREATE INDEX "risk_scores_tier_idx"
    ON "risk_scores" ("tier");
