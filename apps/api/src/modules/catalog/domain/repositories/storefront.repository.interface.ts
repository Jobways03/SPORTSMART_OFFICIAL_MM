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
  filterObj?: Record<string, string>;
}

export interface IStorefrontRepository {
  // ── Product listing (raw SQL for performance) ──
  findProductsPaginated(params: StorefrontListParams): Promise<{ products: any[]; total: number }>;
  findSearchSuggestions(query: string): Promise<Array<{ title: string; slug: string }>>;
  findProductDetailBySlug(slug: string): Promise<any | null>;
  findSellerMappingsForProduct(productId: string): Promise<any[]>;

  // ── Storefront filters ──
  findFilterConfigs(where: any): Promise<any[]>;
  createFilterConfig(data: any): Promise<any>;
  updateFilterConfig(id: string, data: any): Promise<any>;
  deleteFilterConfig(id: string): Promise<void>;
  findFilterConfigById(id: string): Promise<any | null>;
  reorderFilterConfigs(ids: string[]): Promise<void>;

  // ── Pincode lookup ──
  findPostOfficeByPincode(pincode: string): Promise<any[]>;

  // ── Catalog reference (options) ──
  findAllOptionDefinitions(): Promise<any[]>;

  // ── Browse catalog for sellers ──
  findBrowsableProducts(sellerId: string, page: number, limit: number, search?: string, categoryId?: string, brandId?: string): Promise<{ products: any[]; total: number }>;

  // ── Storefront filter faceted counts (raw SQL) ──
  computeBrandFacets(baseConditions: any[], otherConditions: any[]): Promise<{ value: string; label: string; count: number }[]>;
  computePriceRange(baseConditions: any[], otherConditions: any[]): Promise<{ min: number; max: number } | null>;
  computeAvailabilityFacets(baseConditions: any[]): Promise<{ in_stock: number; out_of_stock: number }>;
  computeBooleanMetafieldFacets(defKey: string, allConditions: any[]): Promise<{ val: boolean; count: number }[]>;
  computeNumericMetafieldRange(defKey: string, allConditions: any[]): Promise<{ min: number; max: number } | null>;
  computeTextMetafieldFacets(defKey: string, allConditions: any[]): Promise<{ value: string; count: number }[]>;
  findCollectionProductCategoryIds(collectionId: string): Promise<string[]>;

  // ── Auto-generate filter definitions for category/collection ──
  findFilterableDefinitions(categoryIds: string[]): Promise<any[]>;
}
