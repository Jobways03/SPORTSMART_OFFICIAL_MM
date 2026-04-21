export const PRODUCT_REPOSITORY = Symbol('ProductRepository');

export interface ProductListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  moderationStatus?: string;
  categoryId?: string;
  brandId?: string;
  sellerId?: string;
  hasSellers?: boolean;
}

export interface SellerProductListParams {
  sellerId: string;
  page: number;
  limit: number;
  status?: string;
  search?: string;
  categoryId?: string;
}

export interface ProductListResult {
  products: any[];
  total: number;
}

export interface IProductRepository {
  // ── Admin list / detail ──
  findAllPaginated(params: ProductListParams): Promise<ProductListResult>;
  findByIdWithFullDetails(productId: string): Promise<any | null>;
  findByIdBasic(productId: string): Promise<any | null>;

  // ── Seller list / detail ──
  findBySellerPaginated(params: SellerProductListParams): Promise<ProductListResult>;
  findByIdForSeller(productId: string, sellerId: string): Promise<any | null>;

  // ── CRUD ──
  createInTransaction(data: any, tags?: string[], seo?: any, variants?: any[], statusHistoryEntry?: any): Promise<any>;
  updateInTransaction(productId: string, updateData: any, tags?: string[], seo?: any): Promise<any>;
  softDelete(productId: string): Promise<void>;
  /** Cascades soft-delete to all variants; returns the affected variant ids so the caller can emit domain events. */
  softDeleteWithVariants(productId: string): Promise<string[]>;
  findFullProduct(productId: string): Promise<any | null>;

  // ── Status management ──
  updateStatusInTransaction(productId: string, statusData: any, historyEntry: any): Promise<void>;

  // ── Moderation ──
  approveInTransaction(
    productId: string,
    historyEntries: any[],
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void>;
  rejectInTransaction(
    productId: string,
    reason: string,
    historyEntry: any,
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void>;
  requestChangesInTransaction(
    productId: string,
    note: string,
    historyEntry: any,
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void>;
  submitForReviewInTransaction(productId: string, data: any, historyEntry: any): Promise<void>;

  // ── Merge ──
  mergeProducts(sourceId: string, targetId: string, adminId: string, sellerProfile: any, sourceProduct: any, targetProduct: any): Promise<any[]>;
  findProductForMerge(productId: string): Promise<any | null>;

  // ── Duplicate info ──
  findDuplicateInfo(productId: string): Promise<any | null>;

  // ── Slug check ──
  findBySlug(slug: string): Promise<any | null>;

  // ── Ownership ──
  findByIdAndSeller(productId: string, sellerId: string): Promise<any | null>;

  // ── Code sequence ──
  generateNextProductCode(): Promise<string>;

  // ── Seller lookup ──
  findSellerByEmail(email: string): Promise<any | null>;
  findSellerById(sellerId: string): Promise<any | null>;

  // ── Category/Brand resolution ──
  findOrCreateCategory(name: string): Promise<any>;
  findOrCreateBrand(name: string): Promise<any>;
}
