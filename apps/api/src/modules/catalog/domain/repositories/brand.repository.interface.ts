export const BRAND_REPOSITORY = Symbol('BrandRepository');

export interface BrandListParams {
  page: number;
  limit: number;
  search?: string;
}

export interface IBrandRepository {
  findAllPaginated(params: BrandListParams): Promise<{ brands: any[]; total: number }>;
  findById(id: string): Promise<any | null>;
  findByIdWithProducts(id: string): Promise<any | null>;
  findBySlug(slug: string): Promise<any | null>;
  findBySlugExcluding(slug: string, excludeId: string): Promise<any | null>;
  findByNameInsensitive(name: string): Promise<any | null>;

  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  delete(id: string): Promise<void>;
  deactivate(id: string): Promise<void>;

  /**
   * Phase 35 (2026-05-21) — transactional hard-delete. Re-checks the
   * product count inside the same tx as the delete itself; race-safe
   * against a product being created between the controller's
   * pre-check and the delete. Returns the deleted row's logo fields
   * so the caller can fire Cloudinary cleanup on the publicId.
   * Throws `BRAND_NOT_EMPTY` when the inner check fails.
   */
  deleteTransactional(id: string): Promise<{
    logoUrl: string | null;
    logoPublicId: string | null;
  } | null>;

  findWithCounts(id: string): Promise<any | null>;
  addProductsToBrand(brandId: string, productIds: string[]): Promise<number>;
  removeProductFromBrand(brandId: string, productId: string): Promise<void>;
  updateLogoUrl(id: string, logoUrl: string | null): Promise<any>;
  /**
   * Phase 35 (2026-05-21) — atomic write of logoUrl + logoPublicId.
   * Used by the upload handler so the URL and the Cloudinary publicId
   * always land together.
   */
  updateLogoFields(
    id: string,
    logoUrl: string | null,
    logoPublicId: string | null,
  ): Promise<any>;

  /**
   * Phase 35 (2026-05-21) — append a BrandAuditLog row. Best-effort:
   * failures log but never propagate.
   */
  writeAuditLog(entry: {
    brandId: string;
    action:
      | 'CREATE'
      | 'UPDATE'
      | 'DELETE'
      | 'DEACTIVATE'
      | 'LOGO_CHANGE'
      | 'BULK_ASSIGN';
    adminId?: string | null;
    previousState?: unknown;
    newState?: unknown;
    reason?: string | null;
  }): Promise<void>;

  /**
   * Phase 35 (2026-05-21) — paginated audit log for a single brand.
   */
  findAuditLogForBrand(
    brandId: string,
    opts: { limit?: number; offset?: number },
  ): Promise<unknown[]>;

  // ── Public ──
  findAllActive(search?: string): Promise<any[]>;
}
