export const VARIANT_REPOSITORY = Symbol('VariantRepository');

export interface IVariantRepository {
  findByProductId(productId: string): Promise<any[]>;
  findById(variantId: string, productId: string): Promise<any | null>;
  findByIdWithProduct(variantId: string): Promise<any | null>;
  findVariantSnapshotForOrder(variantId: string): Promise<any | null>;
  findLastSortOrder(productId: string): Promise<number | null>;

  create(data: any): Promise<any>;
  update(variantId: string, data: any): Promise<any>;
  softDelete(variantId: string): Promise<void>;

  bulkUpdate(updates: Array<{ id: string; data: any }>): Promise<any[]>;

  // ── Option management ──
  findOptionValuesByIds(ids: string[]): Promise<any[]>;
  findOrCreateOptionDefinition(name: string): Promise<any>;
  findOrCreateOptionValue(definitionId: string, value: string, sortOrder: number): Promise<any>;

  clearProductOptionsAndVariants(productId: string): Promise<void>;
  createProductOption(productId: string, definitionId: string, sortOrder: number): Promise<void>;
  createProductOptionValue(productId: string, optionValueId: string): Promise<void>;

  setHasVariants(productId: string, hasVariants: boolean): Promise<void>;
}
