import type { Prisma } from '@prisma/client';

export const VARIANT_REPOSITORY = Symbol('VariantRepository');

/**
 * Phase 42 (2026-05-21) — methods accept an optional transaction
 * client so the generate-variants flow can wrap every step in one
 * outer $transaction. When tx is omitted the repo uses its own
 * PrismaService (legacy behaviour preserved).
 */
export type RepoTx = Prisma.TransactionClient | undefined;

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

  clearProductOptionsAndVariants(productId: string, tx?: RepoTx): Promise<void>;
  createProductOption(productId: string, definitionId: string, sortOrder: number, tx?: RepoTx): Promise<void>;
  createProductOptionValue(productId: string, optionValueId: string, tx?: RepoTx): Promise<void>;

  setHasVariants(productId: string, hasVariants: boolean, tx?: RepoTx): Promise<void>;

  // ── Phase 41 (2026-05-21) — destructive-generate guards ──
  collectVariantImagePublicIds(productId: string): Promise<string[]>;
  countActiveVariantInventory(productId: string): Promise<{ withStock: number; cartItems: number }>;
}
