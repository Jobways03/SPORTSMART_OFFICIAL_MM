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
