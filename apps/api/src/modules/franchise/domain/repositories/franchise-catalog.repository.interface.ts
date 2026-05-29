export const FRANCHISE_CATALOG_REPOSITORY = Symbol('FranchiseCatalogRepository');

export interface FranchiseCatalogRepository {
  findByFranchiseId(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      search?: string;
      isActive?: boolean;
      approvalStatus?: string;
    },
  ): Promise<{ mappings: any[]; total: number }>;

  findById(id: string): Promise<any | null>;

  findByFranchiseAndProduct(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null>;

  // Phase 159n — APPROVED + active gated lookup for POS / procurement / stock.
  findApprovedActiveByFranchiseAndProduct(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null>;

  create(data: {
    franchiseId: string;
    productId: string;
    variantId?: string;
    globalSku: string;
    franchiseSku?: string;
    barcode?: string;
    isListedForOnlineFulfillment?: boolean;
  }): Promise<any>;

  createMany(
    data: Array<{
      franchiseId: string;
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      barcode?: string;
      isListedForOnlineFulfillment?: boolean;
    }>,
  ): Promise<number>;

  update(id: string, data: Record<string, unknown>): Promise<any>;

  delete(id: string): Promise<void>;

  // Phase 159n — soft-remove (STOPPED + isActive=false + removed actor/at).
  softRemove(id: string, actorId?: string): Promise<void>;

  findAvailableProducts(params: {
    page: number;
    limit: number;
    search?: string;
    categoryId?: string;
    brandId?: string;
    excludeFranchiseId?: string;
  }): Promise<{ products: any[]; total: number }>;

  approve(id: string, actorId?: string): Promise<any>;

  stop(id: string, actorId?: string, reason?: string | null): Promise<any>;

  reject(id: string, actorId?: string, reason?: string | null): Promise<any>;

  findAllPaginated(params: {
    page: number;
    limit: number;
    franchiseId?: string;
    approvalStatus?: string;
    search?: string;
  }): Promise<{ mappings: any[]; total: number }>;
}
