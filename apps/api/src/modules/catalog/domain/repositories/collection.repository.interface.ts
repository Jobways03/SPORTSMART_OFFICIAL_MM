export const COLLECTION_REPOSITORY = Symbol('CollectionRepository');

export interface CollectionListParams {
  page: number;
  limit: number;
  search?: string;
  includeDeleted?: boolean;
}

export interface AttachProductsResult {
  /** Map rows actually inserted. */
  attached: string[];
  /** ProductIds skipped + the reason (one of: not_found, not_active,
   *  not_approved, deleted, already_attached). */
  skipped: Array<{ productId: string; reason: string }>;
}

export interface ICollectionRepository {
  // ── Admin CRUD ──
  findAllPaginated(params: CollectionListParams): Promise<{ collections: any[]; total: number }>;
  findById(id: string): Promise<any | null>;
  findBySlug(slug: string): Promise<any | null>;
  findByNameInsensitiveExcluding(name: string, excludeId?: string): Promise<any | null>;
  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  delete(id: string): Promise<void>;
  /**
   * Phase 37 (2026-05-21) — soft-delete. Stamps deletedAt; the
   * storefront query filters it out. Cascade-detaches all map rows
   * in the same tx so a restore doesn't bring back stale links.
   * Returns the deleted row's image fields for Cloudinary cleanup.
   */
  softDelete(id: string): Promise<{
    imageUrl: string | null;
    imagePublicId: string | null;
  } | null>;
  /**
   * Phase 37 (2026-05-21) — restore a soft-deleted collection. The
   * map rows are NOT restored (cascade-detach is irreversible by
   * design — admins re-attach products explicitly).
   */
  restore(id: string): Promise<any | null>;

  // ── Products ──
  /**
   * Phase 37 (2026-05-21) — eligibility-filtered attach. Pre-Phase-37
   * any productId landed in the join table regardless of status,
   * leading to "admin sees 12, customer sees 8" UX bugs.
   */
  addProducts(collectionId: string, productIds: string[]): Promise<AttachProductsResult>;
  removeProduct(collectionId: string, productId: string): Promise<void>;
  /**
   * Phase 37 (2026-05-21) — bulk detach. Returns the count actually
   * removed (deleteMany ignores rows that weren't attached).
   */
  removeProducts(collectionId: string, productIds: string[]): Promise<number>;
  /**
   * Phase 37 (2026-05-21) — bulk reorder. Caller must verify all
   * items share the same collectionId. Transactional.
   */
  reorderProducts(
    collectionId: string,
    items: Array<{ productId: string; sortOrder: number }>,
  ): Promise<void>;

  updateImageUrl(id: string, imageUrl: string | null): Promise<any>;
  /**
   * Phase 37 (2026-05-21) — atomic write of imageUrl + imagePublicId.
   */
  updateImageFields(
    id: string,
    imageUrl: string | null,
    imagePublicId: string | null,
  ): Promise<any>;

  // ── Audit log ──
  /**
   * Phase 37 (2026-05-21) — best-effort audit log write. Failures
   * here log but never propagate.
   */
  writeAuditLog(entry: {
    collectionId: string;
    action:
      | 'CREATE'
      | 'UPDATE'
      | 'DELETE'
      | 'RESTORE'
      | 'IMAGE_CHANGE'
      | 'ATTACH'
      | 'DETACH'
      | 'REORDER';
    adminId?: string | null;
    previousState?: unknown;
    newState?: unknown;
    reason?: string | null;
  }): Promise<void>;

  findAuditLogForCollection(
    collectionId: string,
    opts: { limit?: number; offset?: number },
  ): Promise<unknown[]>;

  // ── Public (storefront) ──
  findAllActivePaginated(
    page: number,
    limit: number,
  ): Promise<{ collections: any[]; total: number }>;
  findAllActive(): Promise<any[]>;
  findBySlugWithProducts(slug: string, page: number, limit: number): Promise<any | null>;
}
