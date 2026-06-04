export const CATEGORY_REPOSITORY = Symbol('CategoryRepository');

export interface CategoryListParams {
  page: number;
  limit: number;
  search?: string;
  parentId?: string;
  level?: number;
}

export interface ICategoryRepository {
  findAllPaginated(params: CategoryListParams): Promise<{ categories: any[]; total: number }>;
  findById(id: string): Promise<any | null>;
  findBySlug(slug: string): Promise<any | null>;
  findBySlugExcluding(slug: string, excludeId: string): Promise<any | null>;

  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  /**
   * Phase 33 (2026-05-21) — re-parent variant that cascades `level`
   * to every descendant in the same transaction. Use when `data`
   * includes `parentId` (which implies level changes). The recursion
   * walks the descendant tree via parentId pointers; depth is
   * bounded by application convention (~5 levels), so the per-row
   * level overhead is negligible vs the integrity guarantee.
   */
  updateWithLevelCascade(id: string, data: any, newLevel: number): Promise<any>;
  /**
   * Phase 33 (2026-05-21) — transactional delete. Re-checks the
   * children + products counts inside the same tx as the delete to
   * close the race window where a child gets added between the
   * "is it empty?" check and the actual delete. Returns the deleted
   * row so the caller can fire media cleanup on imageUrl /
   * bannerUrl asset publicIds.
   */
  deleteTransactional(id: string): Promise<{ imageUrl: string | null; bannerUrl: string | null } | null>;
  deactivate(id: string): Promise<void>;

  findWithCounts(id: string): Promise<any | null>;

  // ── Public (storefront) ──
  findActiveTree(): Promise<any[]>;
  findCategoryOptions(categoryId: string): Promise<any[]>;

  // ── Hierarchy walk ──
  findAncestorIds(categoryId: string): Promise<string[]>;

  /**
   * Phase 34 (2026-05-21) — append a CategoryAuditLog row. Best-effort:
   * failures here are logged but never propagated, so an audit-log
   * outage doesn't block a legitimate mutation.
   */
  writeAuditLog(entry: {
    categoryId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'DEACTIVATE' | 'REORDER';
    adminId?: string | null;
    previousState?: unknown;
    newState?: unknown;
    reason?: string | null;
  }): Promise<void>;

  /**
   * Phase 34 (2026-05-21) — bulk reorder siblings under one parent.
   * `updates` must all share the same parentId (controller enforces).
   * Implemented as a single transaction so a partial failure rolls
   * back the sortOrder churn.
   */
  bulkReorder(updates: Array<{ id: string; sortOrder: number }>): Promise<void>;

  /**
   * Phase 34 (2026-05-21) — paginated audit log for a single category.
   * Backs the GET /admin/categories/:id/audit-log endpoint.
   */
  findAuditLogForCategory(
    categoryId: string,
    opts: { limit?: number; offset?: number },
  ): Promise<unknown[]>;
}
