-- Pre-screening risk signal for the verification queue. Lets verifiers
-- glance-approve low-risk orders (GREEN) and focus attention on YELLOW
-- and RED. Computed lazily on first queue interaction; reasons array
-- gives the verifier the human-readable signals that drove the band.
ALTER TABLE "master_orders"
  ADD COLUMN "verification_risk_score"   INTEGER,
  ADD COLUMN "verification_risk_band"    TEXT,
  ADD COLUMN "verification_risk_reasons" JSONB,
  ADD COLUMN "verification_scored_at"    TIMESTAMP(3);

-- Filter / sort by band on the queue list (e.g. "show only red", "claim
-- next green"). Restrict to PLACED so the index stays small.
CREATE INDEX "master_orders_order_status_verification_risk_band_idx"
  ON "master_orders"("order_status", "verification_risk_band");
