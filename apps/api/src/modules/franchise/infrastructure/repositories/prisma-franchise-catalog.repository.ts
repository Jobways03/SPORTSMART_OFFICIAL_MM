import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FranchiseCatalogRepository } from '../../domain/repositories/franchise-catalog.repository.interface';

@Injectable()
export class PrismaFranchiseCatalogRepository implements FranchiseCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByFranchiseId(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      search?: string;
      isActive?: boolean;
      approvalStatus?: string;
    },
  ): Promise<{ mappings: any[]; total: number }> {
    // Exclude mappings whose underlying variant has been soft-deleted
    // by the seller. A mapping pointing to a dead variant is an orphan
    // — keeping it in the list would let the franchise UI surface a
    // product they can no longer stock or sell. Product-level
    // mappings (variantId=null) stay visible.
    //
    // We compose with AND rather than the top-level OR so the search
    // branch below can add its own OR without clobbering this one.
    const where: any = {
      franchiseId,
      product: { isDeleted: false },
      AND: [
        { OR: [{ variantId: null }, { variant: { isDeleted: false } }] },
      ] as any[],
    };

    if (params.isActive !== undefined) {
      where.isActive = params.isActive;
    }

    if (params.approvalStatus) {
      where.approvalStatus = params.approvalStatus;
    }

    if (params.search) {
      where.AND.push({
        OR: [
          { globalSku: { contains: params.search, mode: 'insensitive' } },
          { franchiseSku: { contains: params.search, mode: 'insensitive' } },
          { barcode: { contains: params.search, mode: 'insensitive' } },
          { product: { title: { contains: params.search, mode: 'insensitive' }, isDeleted: false } },
        ],
      });
    }

    const skip = (params.page - 1) * params.limit;

    const [mappings, total] = await this.prisma.$transaction([
      this.prisma.franchiseCatalogMapping.findMany({
        where,
        include: {
          product: {
            include: {
              category: true,
              brand: true,
              images: { where: { sortOrder: 0 }, take: 1 },
            },
          },
          variant: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchiseCatalogMapping.count({ where }),
    ]);

    return { mappings, total };
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.franchiseCatalogMapping.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { where: { sortOrder: 0 }, take: 1 },
          },
        },
        variant: true,
      },
    });
  }

  async findByFranchiseAndProduct(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null> {
    // Critical: this lookup is how POS + allocation decide whether a
    // franchise is permitted to sell / fulfil a given SKU. If the
    // product has been soft-deleted, or the variant has been
    // soft-deleted, the mapping must NOT be considered live even if
    // the FranchiseCatalogMapping row still exists. Without this
    // guard, a POS operator could scan a tombstoned barcode and the
    // sale would pass validation.
    return this.prisma.franchiseCatalogMapping.findFirst({
      where: {
        franchiseId,
        productId,
        variantId: variantId ?? null,
        product: { isDeleted: false },
        ...(variantId ? { variant: { isDeleted: false } } : {}),
      },
    });
  }

  async create(data: {
    franchiseId: string;
    productId: string;
    variantId?: string;
    globalSku: string;
    franchiseSku?: string;
    barcode?: string;
    isListedForOnlineFulfillment?: boolean;
  }): Promise<any> {
    return this.prisma.franchiseCatalogMapping.create({
      data,
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { where: { sortOrder: 0 }, take: 1 },
          },
        },
        variant: true,
      },
    });
  }

  async createMany(
    data: Array<{
      franchiseId: string;
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      barcode?: string;
    }>,
  ): Promise<number> {
    const result = await this.prisma.franchiseCatalogMapping.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  }

  async update(id: string, data: Record<string, unknown>): Promise<any> {
    return this.prisma.franchiseCatalogMapping.update({
      where: { id },
      data,
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { where: { sortOrder: 0 }, take: 1 },
          },
        },
        variant: true,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.franchiseCatalogMapping.delete({ where: { id } });
  }

  async findAvailableProducts(params: {
    page: number;
    limit: number;
    search?: string;
    categoryId?: string;
    brandId?: string;
    excludeFranchiseId?: string;
  }): Promise<{ products: any[]; total: number }> {
    const where: any = {
      status: 'ACTIVE',
      isDeleted: false,
    };

    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { baseSku: { contains: params.search, mode: 'insensitive' } },
        { productCode: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    if (params.categoryId) {
      where.categoryId = params.categoryId;
    }

    if (params.brandId) {
      where.brandId = params.brandId;
    }

    const skip = (params.page - 1) * params.limit;

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          category: true,
          brand: true,
          images: { where: { sortOrder: 0 }, take: 1 },
          variants: {
            where: { isDeleted: false },
            select: {
              id: true,
              title: true,
              sku: true,
              masterSku: true,
              barcode: true,
              price: true,
              stock: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total };
  }

  async approve(id: string): Promise<any> {
    return this.prisma.franchiseCatalogMapping.update({
      where: { id },
      data: { approvalStatus: 'APPROVED', isActive: true },
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { where: { sortOrder: 0 }, take: 1 },
          },
        },
        variant: true,
      },
    });
  }

  async stop(id: string): Promise<any> {
    return this.prisma.franchiseCatalogMapping.update({
      where: { id },
      data: { approvalStatus: 'STOPPED', isActive: false },
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { where: { sortOrder: 0 }, take: 1 },
          },
        },
        variant: true,
      },
    });
  }

  async findAllPaginated(params: {
    page: number;
    limit: number;
    franchiseId?: string;
    approvalStatus?: string;
    search?: string;
  }): Promise<{ mappings: any[]; total: number }> {
    // Same soft-deleted-variant filter as the per-franchise list
    // (see findByFranchiseId). Orphan mappings must not surface in the
    // admin-wide catalog view either.
    const where: any = {
      product: { isDeleted: false },
      AND: [
        { OR: [{ variantId: null }, { variant: { isDeleted: false } }] },
      ] as any[],
    };

    if (params.franchiseId) {
      where.franchiseId = params.franchiseId;
    }

    if (params.approvalStatus) {
      where.approvalStatus = params.approvalStatus;
    }

    if (params.search) {
      where.AND.push({
        OR: [
          { globalSku: { contains: params.search, mode: 'insensitive' } },
          { franchiseSku: { contains: params.search, mode: 'insensitive' } },
          { barcode: { contains: params.search, mode: 'insensitive' } },
          { product: { title: { contains: params.search, mode: 'insensitive' }, isDeleted: false } },
        ],
      });
    }

    const skip = (params.page - 1) * params.limit;

    const [mappings, total] = await this.prisma.$transaction([
      this.prisma.franchiseCatalogMapping.findMany({
        where,
        include: {
          product: {
            include: {
              category: true,
              brand: true,
              images: { where: { sortOrder: 0 }, take: 1 },
            },
          },
          variant: true,
          franchise: {
            select: {
              id: true,
              franchiseCode: true,
              businessName: true,
              ownerName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchiseCatalogMapping.count({ where }),
    ]);

    return { mappings, total };
  }
}
