-- Phase 37 (2026-05-18) — admin tax-config attestation on products.
--
-- Policy: sellers may PROPOSE tax fields when creating / editing
-- products (Phase 26 unlocked the DTOs). Admins must EXPLICITLY
-- attest that the proposed tax config is correct before any
-- invoice can rely on it for STRICT mode. Once attested, any
-- subsequent edit to a tax field on the product auto-resets the
-- attestation so a seller can't sneak misclassification past
-- prior approval.
--
-- See apps/api/prisma/schema/catalog.prisma Product block for the
-- field documentation.

ALTER TABLE "products"
    ADD COLUMN "tax_config_verified"     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "tax_config_verified_at"  TIMESTAMP(3),
    ADD COLUMN "tax_config_verified_by"  TEXT;

-- Index supports the admin moderation-queue filter "show me products
-- with unverified tax config that have already been moderation-
-- approved" (the priority case — products live but tax config not
-- yet attested for STRICT-mode invoicing).
CREATE INDEX "products_tax_config_verified_idx"
    ON "products" ("tax_config_verified");
