-- Franchise tax-ID verification (parity with seller).
-- PAN is admin-attested (manual flag); GSTIN is verified against the
-- government GSTN portal by GstnVerificationService, which writes the portal
-- status + legal-name match back onto the franchise row. Mirrors the
-- verification columns already present on SellerGstin.
ALTER TABLE "franchise_partners"
  ADD COLUMN "pan_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pan_verified_at" TIMESTAMP(3),
  ADD COLUMN "gst_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gst_verified_at" TIMESTAMP(3),
  ADD COLUMN "gstn_portal_status" TEXT,
  ADD COLUMN "gst_legal_name" TEXT,
  ADD COLUMN "legal_name_mismatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gst_verification_failure_reason" TEXT;
