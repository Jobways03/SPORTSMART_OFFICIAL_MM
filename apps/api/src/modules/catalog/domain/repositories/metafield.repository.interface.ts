export const METAFIELD_REPOSITORY = Symbol('MetafieldRepository');

export interface IMetafieldRepository {
  // ── Definitions ──
  findDefinitions(where: any): Promise<any[]>;
  findDefinitionById(id: string): Promise<any | null>;
  findDefinitionByNamespaceKey(namespace: string, key: string, categoryId?: string | null): Promise<any | null>;
  createDefinition(data: any): Promise<any>;
  updateDefinition(id: string, data: any): Promise<any>;
  deleteDefinition(id: string): Promise<void>;
  deactivateDefinition(id: string): Promise<void>;
  countMetafieldValues(definitionId: string): Promise<number>;
  findDefinitionWithCounts(id: string): Promise<any | null>;
  bulkCreateDefinitions(categoryId: string, definitions: any[]): Promise<{ created: any[]; skipped: any[] }>;

  // ── Product metafield values ──
  findProductMetafields(productId: string): Promise<any[]>;
  findAvailableDefinitions(categoryId: string | null): Promise<any[]>;
  upsertProductMetafield(productId: string, definitionId: string, valueData: any): Promise<any>;
  deleteProductMetafield(metafieldId: string): Promise<void>;
  deleteProductMetafieldByDefinition(productId: string, definitionId: string): Promise<void>;
  findProductMetafield(metafieldId: string, productId: string): Promise<any | null>;

  // ── Category hierarchy for definitions ──
  getCategoryHierarchyIds(categoryId: string): Promise<string[]>;

  // ── Phase 39 (2026-05-21) — audit log ──
  writeAuditLog(entry: {
    metafieldDefinitionId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'DEACTIVATE' | 'REACTIVATE' | 'BULK_ASSIGN';
    adminId?: string | null;
    previousState?: unknown;
    newState?: unknown;
    reason?: string | null;
  }): Promise<void>;

  findAuditLogForDefinition(
    definitionId: string,
    opts: { limit?: number; offset?: number },
  ): Promise<unknown[]>;

  // ── Phase 40 (2026-05-21) — filterable toggle helpers ──
  markDefinitionFilterable(
    id: string,
    payload: {
      isFilterable: boolean;
      defaultFilterType?: string | null;
      defaultFilterLabel?: string | null;
      filterDisplayOrder?: number;
    },
  ): Promise<unknown>;

  bulkMarkDefinitionsFilterable(
    ids: string[],
    isFilterable: boolean,
  ): Promise<{ updated: number }>;

  /**
   * Lookup a definition by namespace.key for a given category, walking
   * the category ancestry. Used by the public filter endpoint to map
   * a storefront filter key to the underlying definition (so values
   * can be validated against the choices list).
   */
  findDefinitionByKeyForCategoryHierarchy(
    key: string,
    categoryIds: string[],
  ): Promise<unknown | null>;
}
