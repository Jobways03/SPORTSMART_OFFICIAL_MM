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

  // Franchise self-pause: a franchise temporarily stops selling its OWN
  // approved mapping (STOPPED + isActive=false + stoppedById=franchiseId).
  // Returns the updated mapping, or null if no APPROVED+live row matched
  // (guarded updateMany — the franchise can only pause its own offer).
  pauseByFranchise(
    id: string,
    franchiseId: string,
    reason?: string | null,
  ): Promise<any | null>;

  // Franchise self-resume: lifts a SELF-pause only (stoppedById=franchiseId),
  // back to APPROVED + active. An admin STOP (stoppedById = admin user) is
  // NOT resumable here — it must be re-approved by an admin. Returns the
  // updated mapping, or null if no self-paused row matched.
  resumeByFranchise(id: string, franchiseId: string): Promise<any | null>;

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
