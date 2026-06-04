export const STOREFRONT_REPOSITORY = Symbol('StorefrontRepository');

export interface StorefrontListParams {
  page: number;
  limit: number;
  search?: string;
  categoryId?: string;
  brandId?: string;
  collectionId?: string;
  sortBy?: string;
  minPrice?: string;
  maxPrice?: string;
  sport?: string;
  filterObj?: Record<string, string>;
}

export interface IStorefrontRepository {
  // ── Product listing (raw SQL for performance) ──
  findProductsPaginated(params: StorefrontListParams): Promise<{ products: any[]; total: number }>;
  // Phase 193 (#2) — same-category/brand, in-stock, approved, excluding self.
  findRelatedProducts(args: {
    productId: string;
    categoryId?: string | null;
    brandId?: string | null;
    limit: number;
  }): Promise<any[]>;
  findSearchSuggestions(query: string): Promise<Array<{ title: string; slug: string }>>;
  findProductDetailBySlug(slug: string): Promise<any | null>;
  findSellerMappingsForProduct(productId: string): Promise<any[]>;

  // ── Storefront filters ──
  findFilterConfigs(where: any): Promise<any[]>;
  createFilterConfig(data: any): Promise<any>;
  updateFilterConfig(id: string, data: any): Promise<any>;
  deleteFilterConfig(id: string): Promise<void>;
  findFilterConfigById(id: string): Promise<any | null>;
  // Phase 40 (2026-05-21) — reorderFilterConfigs now validates the
  // input ids and runs in a single transaction. Returns the count of
  // updated rows so the controller can detect partial drift.
  reorderFilterConfigs(ids: string[]): Promise<{ updated: number }>;

  // ── Pincode lookup ──
  findPostOfficeByPincode(pincode: string): Promise<any[]>;

  // ── Catalog reference (options) ──
  findAllOptionDefinitions(): Promise<any[]>;

  // ── Browse catalog for sellers ──
  findBrowsableProducts(sellerId: string, page: number, limit: number, search?: string, categoryId?: string, brandId?: string): Promise<{ products: any[]; total: number }>;

  // ── Storefront filter faceted counts (raw SQL) ──
  computeBrandFacets(baseConditions: any[], otherConditions: any[]): Promise<{ value: string; label: string; count: number }[]>;
  // Phase 194 (#13) — price bounds are money: returned as Decimal-precise
  // strings, coerced to Number only at the client slider boundary.
  computePriceRange(baseConditions: any[], otherConditions: any[]): Promise<{ min: string; max: string } | null>;
  computeAvailabilityFacets(baseConditions: any[]): Promise<{ in_stock: number; out_of_stock: number }>;
  computeBooleanMetafieldFacets(defKey: string, allConditions: any[]): Promise<{ val: boolean; count: number }[]>;
  computeNumericMetafieldRange(defKey: string, allConditions: any[]): Promise<{ min: number; max: number } | null>;
  // Phase 40 (2026-05-21) — accept an optional `limit` (default 200,
  // hard-capped to 500). Pre-Phase-40 the hardcoded LIMIT 50 silently
  // truncated rich filters (e.g. category with 80+ Material values).
  computeTextMetafieldFacets(
    defKey: string,
    allConditions: any[],
    limit?: number,
  ): Promise<{ value: string; count: number }[]>;
  findCollectionProductCategoryIds(collectionId: string): Promise<string[]>;

  // ── Auto-generate filter definitions for category/collection ──
  // Phase 40 (2026-05-21) — now reads `isFilterable=true` flag instead
  // of the hardcoded type allowlist; includes NUMBER_INTEGER /
  // NUMBER_DECIMAL / RATING so range filters work.
  findFilterableDefinitions(categoryIds: string[]): Promise<any[]>;
}
