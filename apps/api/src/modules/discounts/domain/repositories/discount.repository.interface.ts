import { Prisma } from '@prisma/client';

export interface DiscountListResult {
  discounts: any[];
  total: number;
}

export interface DiscountRepository {
  findMany(
    where: Prisma.DiscountWhereInput,
    orderBy: any,
    skip: number,
    take: number,
  ): Promise<any[]>;

  count(where: Prisma.DiscountWhereInput): Promise<number>;

  findById(id: string): Promise<any | null>;

  findByIdWithRelations(id: string): Promise<any | null>;

  findByCode(code: string): Promise<any | null>;

  findByCodeWithProducts(code: string): Promise<any | null>;

  create(data: any): Promise<any>;

  update(id: string, data: any): Promise<any>;

  delete(id: string): Promise<void>;

  // Phase 243 (#5) — atomic create: the discount row + all product/
  // collection scope links in a single transaction so a link failure
  // can't leave a half-built discount. `undefined` scope = no links.
  createWithRelations(
    data: any,
    links: {
      productIds?: string[];
      collectionIds?: string[];
      buyProductIds?: string[];
      getProductIds?: string[];
    },
  ): Promise<any>;

  // Phase 243 (#5) — atomic update: the field update + per-scope link
  // replace (delete+recreate) in one transaction. A scope key that is
  // `undefined` is left untouched; an explicit `[]` clears it.
  updateWithRelations(
    id: string,
    data: any,
    links: {
      productIds?: string[];
      collectionIds?: string[];
      buyProductIds?: string[];
      getProductIds?: string[];
    },
  ): Promise<any>;

  // Phase 243 (#13) — pre-validate FK targets exist so an invalid id
  // surfaces a clean 400 listing the missing ids instead of a raw P2003.
  findExistingProductIds(ids: string[]): Promise<string[]>;

  findExistingCollectionIds(ids: string[]): Promise<string[]>;

  createProductLinks(
    discountId: string,
    productIds: string[],
    scope: string,
  ): Promise<void>;

  createCollectionLinks(
    discountId: string,
    collectionIds: string[],
    scope: string,
  ): Promise<void>;

  deleteProductLinks(discountId: string, scope: string): Promise<void>;

  deleteCollectionLinks(discountId: string, scope: string): Promise<void>;

  incrementUsedCount(id: string): Promise<void>;
}

export const DISCOUNT_REPOSITORY = Symbol('DiscountRepository');
