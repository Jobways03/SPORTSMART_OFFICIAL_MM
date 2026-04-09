import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ICollectionRepository, CollectionListParams } from '../../domain/repositories/collection.repository.interface';

@Injectable()
export class PrismaCollectionRepository implements ICollectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPaginated(params: CollectionListParams): Promise<{ collections: any[]; total: number }> {
    const { page, limit, search } = params;
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [collections, total] = await Promise.all([
      this.prisma.productCollection.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productCollection.count({ where }),
    ]);
    return { collections, total };
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.productCollection.findUnique({
      where: { id },
      include: {
        products: {
          include: {
            product: {
              select: {
                id: true, title: true, slug: true, status: true, basePrice: true,
                images: { where: { isPrimary: true }, select: { url: true }, take: 1 },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async findBySlug(slug: string): Promise<any | null> {
    return this.prisma.productCollection.findUnique({ where: { slug } });
  }

  async create(data: any): Promise<any> {
    return this.prisma.productCollection.create({ data });
  }

  async update(id: string, data: any): Promise<any> {
    return this.prisma.productCollection.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.productCollection.delete({ where: { id } });
  }

  async addProducts(collectionId: string, productIds: string[]): Promise<number> {
    const existing = await this.prisma.productCollectionMap.findMany({
      where: { collectionId, productId: { in: productIds } },
      select: { productId: true },
    });
    const existingIds = new Set(existing.map((e) => e.productId));
    const newIds = productIds.filter((pid) => !existingIds.has(pid));
    if (newIds.length > 0) {
      await this.prisma.productCollectionMap.createMany({
        data: newIds.map((productId) => ({ productId, collectionId })),
      });
    }
    return newIds.length;
  }

  async removeProduct(collectionId: string, productId: string): Promise<void> {
    await this.prisma.productCollectionMap.deleteMany({
      where: { collectionId, productId },
    });
  }

  async updateImageUrl(id: string, imageUrl: string | null): Promise<any> {
    return this.prisma.productCollection.update({ where: { id }, data: { imageUrl } });
  }

  async findAllActive(): Promise<any[]> {
    return this.prisma.productCollection.findMany({
      where: { isActive: true },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findBySlugWithProducts(slug: string, page: number, limit: number): Promise<any | null> {
    const collection = await this.prisma.productCollection.findUnique({ where: { slug } });
    if (!collection || !collection.isActive) return null;

    const where = {
      collectionId: collection.id,
      product: {
        status: 'ACTIVE' as const,
        isDeleted: false,
        moderationStatus: 'APPROVED' as const,
      },
    };

    const [maps, total] = await Promise.all([
      this.prisma.productCollectionMap.findMany({
        where,
        include: {
          product: {
            select: {
              id: true, title: true, slug: true, shortDescription: true,
              basePrice: true, compareAtPrice: true,
              images: { where: { isPrimary: true }, select: { url: true, altText: true }, take: 1 },
              variants: {
                where: { isDeleted: false, status: 'ACTIVE' as const, stock: { gt: 0 } },
                select: { price: true, compareAtPrice: true, stock: true },
                orderBy: { price: 'asc' }, take: 1,
              },
              category: { select: { name: true } },
              brand: { select: { name: true } },
              seller: { select: { sellerShopName: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productCollectionMap.count({ where }),
    ]);

    return { collection, maps, total };
  }
}
