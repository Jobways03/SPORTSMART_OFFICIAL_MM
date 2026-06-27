-- Delegated settlements (2026-06-27).
-- Tag each SettlementCycle with the seller TYPE it settles, so the type-scoped
-- D2C_ADMIN / RETAILER_ADMIN can create + approve + pay settlement cycles for
-- ONLY their own sellers (mirrors the franchise node-scoped settlement flow).
--
-- NULLable + no default: existing rows (legacy pre-delegation seller cycles and
-- franchise-flow cycles, which share this table) stay NULL = "unscoped/legacy",
-- which the new scope checks treat as a super-admin/global cycle. New seller
-- cycles are always stamped D2C or RETAIL by createCycle.
--
-- "SellerType" enum already exists (sellers.seller_type); this just references it.

ALTER TABLE "settlement_cycles" ADD COLUMN "seller_type" "SellerType";
