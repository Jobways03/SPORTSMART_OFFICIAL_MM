-- Phase 113 — decision analytics indexes. Without these, "decisions by admin X
-- this month" / "refund totals by liability party or remedy" full-scan disputes.
CREATE INDEX "disputes_decision_by_admin_id_decision_at_idx" ON "disputes"("decision_by_admin_id", "decision_at");
CREATE INDEX "disputes_liability_party_decision_at_idx" ON "disputes"("liability_party", "decision_at");
CREATE INDEX "disputes_customer_remedy_decision_at_idx" ON "disputes"("customer_remedy", "decision_at");
