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
