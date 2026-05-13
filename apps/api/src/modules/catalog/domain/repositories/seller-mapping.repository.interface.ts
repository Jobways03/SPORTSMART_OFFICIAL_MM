export const SELLER_MAPPING_REPOSITORY = Symbol('SellerMappingRepository');

export interface SellerMappingListParams {
  page: number;
  limit: number;
  sellerId?: string;
  productId?: string;
  isActive?: boolean;
  approvalStatus?: string;
  search?: string;
}

export interface ISellerMappingRepository {
  // ── Admin queries ──
  findByProduct(productId: string): Promise<any[]>;
  findAllPaginated(params: SellerMappingListParams): Promise<{ mappings: any[]; total: number }>;
  findPendingPaginated(page: number, limit: number): Promise<{ mappings: any[]; total: number }>;
  findById(mappingId: string): Promise<any | null>;
  update(mappingId: string, data: any): Promise<any>;
  approve(mappingId: string): Promise<any>;
  stop(mappingId: string): Promise<any>;

  // ── Seller queries ──
  findBySeller(sellerId: string): Promise<any[]>;
  findDistinctProductIdsBySeller(sellerId: string): Promise<string[]>;
  findBySellerAndProduct(sellerId: string, productId: string, variantId?: string | null): Promise<any | null>;
  findBySellerForProduct(sellerId: string, productId: string): Promise<any[]>;
  create(data: any): Promise<any>;
  createMany(data: any[]): Promise<any[]>;
  delete(mappingId: string): Promise<void>;
  /**
   * Phase 1 (PR 1.10) — bulk stock-import floor.
   *
   * Enforces `stockQty >= reservedQty` per row inside a single
   * transaction. Throws `StockBelowReservedError` (from
   * `../errors/stock-below-reserved.error`) if any row would push
   * stock below its reserved count — the whole transaction rolls
   * back so the seller's catalog never lands in a half-imported state.
   *
   * On success, `violations` is `[]` and `updated` lists the touched
   * mappings (id + new stockQty + variant/product for downstream
   * variant-stock sync).
   */
  bulkUpdateStock(
    updates: Array<{ mappingId: string; stockQty: number }>,
  ): Promise<{
    updated: Array<{
      id: string;
      stockQty: number;
      variantId: string | null;
      productId: string;
    }>;
    violations: Array<{
      mappingId: string;
      requestedStock: number;
      reservedQty: number;
    }>;
  }>;
  deleteBySellerProductVariantNull(sellerId: string, productId: string): Promise<void>;

  // ── My products (seller) ──
  findMyProductsPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ products: any[]; total: number }>;

  // ── Service area ──
  findServiceAreasPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ serviceAreas: any[]; total: number }>;
  addServiceAreas(sellerId: string, pincodes: string[]): Promise<number>;
  removeServiceArea(sellerId: string, pincode: string): Promise<void>;
  removeServiceAreas(sellerId: string, pincodes: string[]): Promise<number>;
  findServiceArea(sellerId: string, pincode: string): Promise<any | null>;

  // ── Auto-repair ──
  autoRepairMissingMappingsForSeller(sellerId: string): Promise<number>;

  // ── Product validation for mapping ──
  findProductForMapping(productId: string): Promise<any | null>;
  findVariantForMapping(variantId: string, productId: string): Promise<any | null>;
  findPostOfficeByPincode(pincode: string): Promise<any | null>;
}
