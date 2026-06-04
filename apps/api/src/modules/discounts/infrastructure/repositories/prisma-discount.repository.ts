import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DiscountRepository } from '../../domain/repositories/discount.repository.interface';
import { Prisma } from '@prisma/client';

@Injectable()
export class PrismaDiscountRepository implements DiscountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.DiscountWhereInput,
    orderBy: any,
    skip: number,
    take: number,
  ): Promise<any[]> {
    return this.prisma.discount.findMany({ where, orderBy, skip, take });
  }

  async count(where: Prisma.DiscountWhereInput): Promise<number> {
    return this.prisma.discount.count({ where });
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.discount.findUnique({ where: { id } });
  }

  async findByIdWithRelations(id: string): Promise<any | null> {
    return this.prisma.discount.findUnique({
      where: { id },
      include: {
        products: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                images: {
                  where: { isPrimary: true },
                  select: { url: true },
                  take: 1,
                },
              },
            },
          },
        },
        collections: {
          include: {
            collection: { select: { id: true, name: true } },
          },
        },
        eligibilityRules: {
          select: { id: true, ruleType: true, valueJson: true },
        },
      },
    });
  }

  async findByCode(code: string): Promise<any | null> {
    return this.prisma.discount.findUnique({ where: { code } });
  }

  async findByCodeWithProducts(code: string): Promise<any | null> {
    return this.prisma.discount.findUnique({
      where: { code },
      include: { products: true },
    });
  }

  async create(data: any): Promise<any> {
    return this.prisma.discount.create({ data });
  }

  async update(id: string, data: any): Promise<any> {
    return this.prisma.discount.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.discount.delete({ where: { id } });
  }

  // Phase 243 (#5) — atomic create of the discount + its scope links.
  async createWithRelations(
    data: any,
    links: {
      productIds?: string[];
      collectionIds?: string[];
      buyProductIds?: string[];
      getProductIds?: string[];
    },
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const discount = await tx.discount.create({ data });
      const productScopes: Array<[string, string[] | undefined]> = [
        ['APPLIES', links.productIds],
        ['BUY', links.buyProductIds],
        ['GET', links.getProductIds],
      ];
      for (const [scope, ids] of productScopes) {
        if (ids && ids.length) {
          await tx.discountProduct.createMany({
            // #14 — de-dupe a productId repeated within the array.
            data: ids.map((productId) => ({
              discountId: discount.id,
              productId,
              scope,
            })),
            skipDuplicates: true,
          });
        }
      }
      if (links.collectionIds && links.collectionIds.length) {
        await tx.discountCollection.createMany({
          data: links.collectionIds.map((collectionId) => ({
            discountId: discount.id,
            collectionId,
            scope: 'APPLIES',
          })),
          skipDuplicates: true,
        });
      }
      return discount;
    });
  }

  // Phase 243 (#5) — atomic update + per-scope link replace.
  async updateWithRelations(
    id: string,
    data: any,
    links: {
      productIds?: string[];
      collectionIds?: string[];
      buyProductIds?: string[];
      getProductIds?: string[];
    },
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.discount.update({ where: { id }, data });
      const productScopes: Array<[string, string[] | undefined]> = [
        ['APPLIES', links.productIds],
        ['BUY', links.buyProductIds],
        ['GET', links.getProductIds],
      ];
      for (const [scope, ids] of productScopes) {
        if (ids !== undefined) {
          await tx.discountProduct.deleteMany({
            where: { discountId: id, scope },
          });
          if (ids.length) {
            await tx.discountProduct.createMany({
              data: ids.map((productId) => ({
                discountId: id,
                productId,
                scope,
              })),
              skipDuplicates: true,
            });
          }
        }
      }
      if (links.collectionIds !== undefined) {
        await tx.discountCollection.deleteMany({
          where: { discountId: id, scope: 'APPLIES' },
        });
        if (links.collectionIds.length) {
          await tx.discountCollection.createMany({
            data: links.collectionIds.map((collectionId) => ({
              discountId: id,
              collectionId,
              scope: 'APPLIES',
            })),
            skipDuplicates: true,
          });
        }
      }
      return updated;
    });
  }

  // Phase 243 (#13) — which of the supplied product ids actually exist.
  async findExistingProductIds(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async findExistingCollectionIds(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.productCollection.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async createProductLinks(
    discountId: string,
    productIds: string[],
    scope: string,
  ): Promise<void> {
    await this.prisma.discountProduct.createMany({
      data: productIds.map((productId) => ({ discountId, productId, scope })),
    });
  }

  async createCollectionLinks(
    discountId: string,
    collectionIds: string[],
    scope: string,
  ): Promise<void> {
    await this.prisma.discountCollection.createMany({
      data: collectionIds.map((collectionId) => ({
        discountId,
        collectionId,
        scope,
      })),
    });
  }

  async deleteProductLinks(
    discountId: string,
    scope: string,
  ): Promise<void> {
    await this.prisma.discountProduct.deleteMany({
      where: { discountId, scope },
    });
  }

  async deleteCollectionLinks(
    discountId: string,
    scope: string,
  ): Promise<void> {
    await this.prisma.discountCollection.deleteMany({
      where: { discountId, scope },
    });
  }

  async incrementUsedCount(id: string): Promise<void> {
    await this.prisma.discount.update({
      where: { id },
      data: { usedCount: { increment: 1 } },
    });
  }
}
