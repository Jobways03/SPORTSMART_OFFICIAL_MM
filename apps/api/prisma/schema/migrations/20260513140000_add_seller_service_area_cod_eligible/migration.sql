-- Sprint 4 Story 3.1 — per-pincode COD eligibility on seller service areas.
--
-- Independent of `is_active` so a seller can deliver to a pincode
-- (active=true) without offering COD there (cod_eligible=false). This
-- is the common case for high-risk / first-mile-difficult pincodes.
--
-- DEFAULT FALSE so existing rows become delivery-only on migration —
-- the seller must opt in to COD per-pincode. Risk-conservative;
-- matches the default-deny posture the COD rule engine uses platform-
-- wide for CUSTOMER_RISK / VALUE_LIMIT.

ALTER TABLE "seller_service_areas"
  ADD COLUMN "cod_eligible" BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for the "show me only COD-eligible pincodes for this
-- seller" admin query path. Cold queries that don't filter on
-- cod_eligible still use the existing (seller_id) index.
CREATE INDEX "seller_service_areas_seller_id_cod_eligible_idx"
  ON "seller_service_areas"("seller_id")
  WHERE "cod_eligible" = TRUE;
