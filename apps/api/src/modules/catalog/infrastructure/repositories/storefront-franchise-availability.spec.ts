// Regression: franchise products must be visible on the storefront.
//
// Before this, the storefront availability gate only consulted
// `seller_product_mappings`, so franchise-tier products (which live in
// `franchise_catalog_mappings` + `franchise_stock`) were structurally
// invisible — active, listed, in stock, yet absent from the listing/search/
// facets. The in-stock predicate is now centralized in
// `PrismaStorefrontRepository.inStockCondition()` (a Prisma.Sql) and used by
// every storefront availability site. These tests assert the predicate unions
// BOTH sources with the correct franchise gate, so a future change that drops
// franchise visibility fails here loudly.

import { PrismaStorefrontRepository } from './prisma-storefront.repository';

describe('Storefront availability — franchise visibility (read-side union)', () => {
  // inStockCondition() does not touch Prisma; a stub client is enough.
  const repo = new PrismaStorefrontRepository({} as any);
  const sql = repo.inStockCondition().sql;

  it('unions seller AND franchise sources with an OR', () => {
    expect(sql).toContain('seller_product_mappings');
    expect(sql).toContain('franchise_catalog_mappings');
    expect(sql).toContain('franchise_stock');
    expect(sql).toContain('franchise_partners');
    expect(sql).toMatch(/\bOR\b/);
  });

  it('applies the correct franchise availability gate', () => {
    // Mapping must be active, listed for online fulfillment, and approved.
    expect(sql).toContain('is_active = true');
    expect(sql).toContain('is_listed_for_online_fulfillment = true');
    expect(sql).toContain("approval_status = 'APPROVED'");
    // The franchise itself must be ACTIVE.
    expect(sql).toContain("fp.status = 'ACTIVE'");
    // Franchise stock must be available.
    expect(sql).toContain('available_qty > 0');
    // Variant-aware join (handles product-level NULL variant too).
    expect(sql).toContain('IS NOT DISTINCT FROM');
  });

  it('keeps the seller gate intact (does not regress D2C/retail)', () => {
    expect(sql).toContain("spm.approval_status = 'APPROVED'");
    expect(sql).toContain('(spm.stock_qty - spm.reserved_qty) > 0');
  });
});
