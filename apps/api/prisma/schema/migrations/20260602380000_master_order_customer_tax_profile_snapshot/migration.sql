-- Phase 200 (Customer Tax Profile audit #11) — point-in-time snapshot of the
-- buyer tax profile captured at ORDER PLACEMENT.
--
-- WHY: invoice generation (TaxDocumentService.generateForSubOrder) runs at
-- sub-order fulfilment, which can be hours/days AFTER place-order. It resolves
-- the buyer profile LIVE from customer_tax_profiles by MasterOrder
-- .selected_tax_profile_id. If the customer deletes that profile in the
-- meantime, the live lookup returns null and the service throws
-- BadRequestAppException("Selected tax profile … not found") — invoice
-- generation then FAILS PERMANENTLY for that order, blocking GSTR-1.
--
-- This nullable JSON column lets place-order persist {gstin, legalName,
-- billingAddress, stateCode} so invoice-gen can fall back to the snapshot when
-- the live row is gone (see TaxDocumentService change in this phase). It is a
-- forensic/fallback field — nullable, no backfill required (pre-existing orders
-- keep the current live-lookup behaviour; only orders placed after this column
-- exists carry a snapshot).
--
-- CROSS-MODULE: the matching Prisma model field lives in orders.prisma (owned
-- by another agent) and is applied by the central validator:
--   customerTaxProfileSnapshot Json? @map("customer_tax_profile_snapshot")
-- The place-order write-site (checkout repo placeOrderTransaction) is also
-- surfaced for central wiring.

ALTER TABLE "master_orders"
  ADD COLUMN IF NOT EXISTS "customer_tax_profile_snapshot" JSONB;
