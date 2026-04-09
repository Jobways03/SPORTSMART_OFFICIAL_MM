import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ISellerMappingRepository, SellerMappingListParams } from '../../domain/repositories/seller-mapping.repository.interface';

const MAPPING_SELLER_SELECT = {
  id: true, sellerName: true, sellerShopName: true, email: true, status: true, storeAddress: true, sellerZipCode: true,
};
const MAPPING_PRODUCT_SELECT = {
  id: true, title: true, slug: true, productCode: true, status: true,
};
const MAPPING_VARIANT_SELECT = {
  id: true, masterSku: true, title: true, sku: true,
};

@Injectable()
export class PrismaSellerMappingRepository implements ISellerMappingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProduct(productId: string): Promise<any[]> {
    return this.prisma.sellerProductMapping.findMany({
      where: { productId },
      include: {
        seller: { select: MAPPING_SELLER_SELECT },
        variant: { select: MAPPING_VARIANT_SELECT },
      },
      orderBy: { operationalPriority: 'desc' },
    });
  }

  async findAllPaginated(params: SellerMappingListParams): Promise<{ mappings: any[]; total: number }> {
    const { page, limit, sellerId, productId, isActive, approvalStatus, search } = params;
    const where: any = {};
    if (sellerId) where.sellerId = sellerId;
    if (productId) where.productId = productId;
    if (isActive !== undefined) where.isActive = isActive;
    if (approvalStatus) where.approvalStatus = approvalStatus;
    if (search) {
      where.OR = [
        { product: { title: { contains: search, mode: 'insensitive' } } },
        { seller: { sellerName: { contains: search, mode: 'insensitive' } } },
        { seller: { sellerShopName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [mappings, total] = await Promise.all([
      this.prisma.sellerProductMapping.findMany({
        where,
        include: {
          seller: { select: MAPPING_SELLER_SELECT },
          product: { select: MAPPING_PRODUCT_SELECT },
          variant: { select: MAPPING_VARIANT_SELECT },
        },
        orderBy: [{ operationalPriority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sellerProductMapping.count({ where }),
    ]);
    return { mappings, total };
  }

  async findPendingPaginated(page: number, limit: number): Promise<{ mappings: any[]; total: number }> {
    const where = { approvalStatus: 'PENDING_APPROVAL' as const };
    const [mappings, total] = await Promise.all([
      this.prisma.sellerProductMapping.findMany({
        where,
        include: {
          seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true, status: true } },
          product: { select: MAPPING_PRODUCT_SELECT },
          variant: { select: MAPPING_VARIANT_SELECT },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sellerProductMapping.count({ where }),
    ]);
    return { mappings, total };
  }

  async findById(mappingId: string): Promise<any | null> {
    return this.prisma.sellerProductMapping.findUnique({ where: { id: mappingId } });
  }

  async update(mappingId: string, data: any): Promise<any> {
    return this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data,
      include: {
        seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
        product: { select: { id: true, title: true, slug: true, productCode: true } },
        variant: { select: MAPPING_VARIANT_SELECT },
      },
    });
  }

  async approve(mappingId: string): Promise<any> {
    return this.update(mappingId, { approvalStatus: 'APPROVED', isActive: true });
  }

  async stop(mappingId: string): Promise<any> {
    return this.update(mappingId, { approvalStatus: 'STOPPED', isActive: false });
  }

  async findBySeller(sellerId: string): Promise<any[]> {
    return this.prisma.sellerProductMapping.findMany({
      where: { sellerId },
      select: { id: true, sellerId: true },
    });
  }

  async findDistinctProductIdsBySeller(sellerId: string): Promise<string[]> {
    const mappings = await this.prisma.sellerProductMapping.findMany({
      where: { sellerId },
      select: { productId: true },
      distinct: ['productId'],
    });
    return mappings.map((m) => m.productId);
  }

  async findBySellerAndProduct(sellerId: string, productId: string, variantId?: string | null): Promise<any | null> {
    return this.prisma.sellerProductMapping.findFirst({
      where: { sellerId, productId, variantId: variantId ?? null },
    });
  }

  async findBySellerForProduct(sellerId: string, productId: string): Promise<any[]> {
    return this.prisma.sellerProductMapping.findMany({
      where: { sellerId, productId },
      select: { variantId: true },
    });
  }

  async create(data: any): Promise<any> {
    return this.prisma.sellerProductMapping.create({
      data,
      include: {
        product: { select: { id: true, title: true, productCode: true } },
        variant: { select: { id: true, sku: true, price: true } },
      },
    });
  }

  async createMany(data: any[]): Promise<any[]> {
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const d of data) {
        const mapping = await tx.sellerProductMapping.create({
          data: d,
          include: {
            product: { select: { id: true, title: true, productCode: true } },
            variant: { select: { id: true, sku: true, price: true } },
          },
        });
        results.push(mapping);
      }
      return results;
    });
  }

  async delete(mappingId: string): Promise<void> {
    await this.prisma.sellerProductMapping.delete({ where: { id: mappingId } });
  }

  async bulkUpdateStock(updates: Array<{ mappingId: string; stockQty: number }>): Promise<any[]> {
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const update of updates) {
        const result = await tx.sellerProductMapping.update({
          where: { id: update.mappingId },
          data: { stockQty: update.stockQty },
          select: { id: true, stockQty: true, variantId: true, productId: true },
        });
        results.push(result);
      }
      return results;
    });
  }

  async deleteBySellerProductVariantNull(sellerId: string, productId: string): Promise<void> {
    await this.prisma.sellerProductMapping.deleteMany({
      where: { sellerId, productId, variantId: null },
    });
  }

  async findMyProductsPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ products: any[]; total: number }> {
    const where: any = {
      sellerMappings: { some: { sellerId } },
      isDeleted: false,
    };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { productCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          sellerMappings: {
            where: { sellerId },
            include: {
              variant: {
                select: {
                  id: true, sku: true, price: true, compareAtPrice: true,
                  optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { title: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { products, total };
  }

  async findServiceAreasPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ serviceAreas: any[]; total: number }> {
    const where: any = { sellerId, isActive: true };
    if (search) where.pincode = { contains: search };

    const [serviceAreas, total] = await Promise.all([
      this.prisma.sellerServiceArea.findMany({
        where,
        orderBy: { pincode: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sellerServiceArea.count({ where }),
    ]);
    return { serviceAreas, total };
  }

  async addServiceAreas(sellerId: string, pincodes: string[]): Promise<number> {
    const result = await this.prisma.sellerServiceArea.createMany({
      data: pincodes.map((pincode) => ({ sellerId, pincode, isActive: true })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async removeServiceArea(sellerId: string, pincode: string): Promise<void> {
    await this.prisma.sellerServiceArea.delete({
      where: { sellerId_pincode: { sellerId, pincode } },
    });
  }

  async removeServiceAreas(sellerId: string, pincodes: string[]): Promise<number> {
    const result = await this.prisma.sellerServiceArea.deleteMany({
      where: { sellerId, pincode: { in: pincodes } },
    });
    return result.count;
  }

  async findServiceArea(sellerId: string, pincode: string): Promise<any | null> {
    return this.prisma.sellerServiceArea.findUnique({
      where: { sellerId_pincode: { sellerId, pincode } },
    });
  }

  async findProductForMapping(productId: string): Promise<any | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { where: { isDeleted: false }, select: { id: true } },
      },
    });
  }

  async findVariantForMapping(variantId: string, productId: string): Promise<any | null> {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
    });
  }

  async findPostOfficeByPincode(pincode: string): Promise<any | null> {
    return this.prisma.postOffice.findFirst({
      where: { pincode, latitude: { not: null } },
      select: { latitude: true, longitude: true },
    });
  }
}
