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
}
