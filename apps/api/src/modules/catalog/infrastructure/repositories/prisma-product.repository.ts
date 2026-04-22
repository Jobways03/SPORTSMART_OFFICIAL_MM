import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  IProductRepository,
  ProductListParams,
  ProductListResult,
  SellerProductListParams,
} from '../../domain/repositories/product.repository.interface';

@Injectable()
export class PrismaProductRepository implements IProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPaginated(params: ProductListParams): Promise<ProductListResult> {
    const { page, limit, search, status, moderationStatus, categoryId, sellerId, hasSellers } = params;

    const where: any = { isDeleted: false };
    if (status) where.status = status;
    if (moderationStatus) where.moderationStatus = moderationStatus;
    if (categoryId) where.categoryId = categoryId;
    if (sellerId) where.sellerId = sellerId;
    if (hasSellers) {
      where.OR = [
        ...(where.OR || []),
        { sellerId: { not: null } },
        { sellerMappings: { some: {} } },
      ];
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { baseSku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: { where: { isDeleted: false }, select: { stock: true } },
          sellerMappings: {
            where: { approvalStatus: 'APPROVED', isActive: true },
            select: { stockQty: true, reservedQty: true },
          },
          _count: { select: { variants: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total };
  }

  async findByIdWithFullDetails(productId: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      include: {
        seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
        variants: {
          where: { isDeleted: false },
          include: {
            optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
            images: { orderBy: { sortOrder: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        options: { include: { optionDefinition: true }, orderBy: { sortOrder: 'asc' } },
        optionValues: { include: { optionValue: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        tags: true,
        seo: true,
        category: true,
        brand: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async findByIdBasic(productId: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });
  }

  async findBySellerPaginated(params: SellerProductListParams): Promise<ProductListResult> {
    const { sellerId, page, limit, status, search, categoryId } = params;

    const where: any = { sellerId, isDeleted: false };
    if (status) where.status = status;
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { baseSku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: { where: { isDeleted: false }, select: { stock: true } },
          _count: { select: { variants: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total };
  }

  async findByIdForSeller(productId: string, sellerId: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, sellerId, isDeleted: false },
      include: {
        variants: {
          where: { isDeleted: false },
          include: {
            optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
            images: { orderBy: { sortOrder: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        options: { include: { optionDefinition: true }, orderBy: { sortOrder: 'asc' } },
        optionValues: { include: { optionValue: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        tags: true,
        seo: true,
        category: true,
        brand: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async createInTransaction(
    data: any,
    tags?: string[],
    seo?: any,
    variants?: any[],
    statusHistoryEntry?: any,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({ data });

      if (tags && tags.length > 0) {
        await tx.productTag.createMany({
          data: tags.map((tag) => ({ productId: newProduct.id, tag })),
        });
      }

      if (seo) {
        await tx.productSeo.create({
          data: { productId: newProduct.id, metaTitle: seo.metaTitle, metaDescription: seo.metaDescription, handle: seo.handle },
        });
      }

      if (variants && variants.length > 0) {
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i];
          const variant = await tx.productVariant.create({
            data: {
              productId: newProduct.id,
              price: v.price,
              compareAtPrice: v.compareAtPrice,
              costPrice: v.costPrice,
              sku: v.sku,
              stock: v.stock ?? 0,
              weight: v.weight,
              sortOrder: i,
            },
          });
          if (v.optionValueIds && v.optionValueIds.length > 0) {
            await tx.productVariantOptionValue.createMany({
              data: v.optionValueIds.map((ovId: string) => ({ variantId: variant.id, optionValueId: ovId })),
            });
          }
        }
      }

      if (statusHistoryEntry) {
        await tx.productStatusHistory.create({
          data: { productId: newProduct.id, ...statusHistoryEntry },
        });
      }

      return newProduct;
    });
  }

  async updateInTransaction(productId: string, updateData: any, tags?: string[], seo?: any): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id: productId }, data: updateData });

      if (tags !== undefined) {
        await tx.productTag.deleteMany({ where: { productId } });
        if (tags.length > 0) {
          await tx.productTag.createMany({ data: tags.map((tag) => ({ productId, tag })) });
        }
      }

      if (seo !== undefined) {
        await tx.productSeo.upsert({
          where: { productId },
          create: { productId, metaTitle: seo.metaTitle, metaDescription: seo.metaDescription, handle: seo.handle },
          update: { metaTitle: seo.metaTitle, metaDescription: seo.metaDescription, handle: seo.handle },
        });
      }

      return updated;
    });
  }

  async softDelete(productId: string): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async softDeleteWithVariants(productId: string): Promise<string[]> {
    // Returns the ids of the variants that were soft-deleted as part
    // of the cascade, so the caller can emit downstream events
    // (catalog.variant.soft_deleted) per variant. Querying inside the
    // same transaction before the updateMany keeps the list honest
    // under concurrent writes.
    return this.prisma.$transaction(async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: { productId, isDeleted: false },
        select: { id: true },
      });
      const variantIds = variants.map((v) => v.id);

      await tx.productVariant.updateMany({
        where: { productId },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      await tx.product.update({
        where: { id: productId },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      return variantIds;
    });
  }

  async findFullProduct(productId: string): Promise<any | null> {
    // Soft-deleted products must not surface in fetched-by-id reads — all
    // other product reads in this repo already filter `isDeleted: false`
    // and this was the only one that didn't, so callers could receive a
    // tombstoned record if an id leaked through a URL or stale cache.
    return this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      include: {
        tags: true,
        seo: true,
        variants: { where: { isDeleted: false } },
        category: true,
        brand: true,
        images: { orderBy: { sortOrder: 'asc' } },
        seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
        sellerMappings: true,
      },
    });
  }

  async updateStatusInTransaction(productId: string, statusData: any, historyEntry: any): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: statusData });
      await tx.productStatusHistory.create({ data: { productId, ...historyEntry } });
    });
  }

  async approveInTransaction(
    productId: string,
    historyEntries: any[],
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void> {
    const reviewedAt = moderator?.reviewedAt ?? new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          status: 'ACTIVE',
          moderationStatus: 'APPROVED',
          moderationNote: null,
          // Clear any prior rejection/change-request reason so the audit
          // panel shows a clean slate after approval. Previous decisions
          // remain visible through ProductStatusHistory.
          rejectionReason: null,
          changeRequestNote: null,
          moderatorId: moderator?.moderatorId ?? null,
          reviewedAt,
        },
      });
      for (const entry of historyEntries) {
        await tx.productStatusHistory.create({ data: { productId, ...entry } });
      }
    });
  }

  async rejectInTransaction(
    productId: string,
    reason: string,
    historyEntry: any,
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void> {
    const reviewedAt = moderator?.reviewedAt ?? new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          status: 'REJECTED',
          moderationStatus: 'REJECTED',
          moderationNote: reason,
          rejectionReason: reason,
          changeRequestNote: null,
          moderatorId: moderator?.moderatorId ?? null,
          reviewedAt,
        },
      });
      await tx.productStatusHistory.create({ data: { productId, ...historyEntry } });
    });
  }

  async requestChangesInTransaction(
    productId: string,
    note: string,
    historyEntry: any,
    moderator?: { moderatorId: string; reviewedAt?: Date },
  ): Promise<void> {
    const reviewedAt = moderator?.reviewedAt ?? new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          status: 'CHANGES_REQUESTED',
          moderationStatus: 'CHANGES_REQUESTED',
          moderationNote: note,
          changeRequestNote: note,
          rejectionReason: null,
          moderatorId: moderator?.moderatorId ?? null,
          reviewedAt,
        },
      });
      await tx.productStatusHistory.create({ data: { productId, ...historyEntry } });
    });
  }

  async submitForReviewInTransaction(productId: string, data: any, historyEntry: any): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data });
      await tx.productStatusHistory.create({ data: { productId, ...historyEntry } });
    });
  }

  async mergeProducts(
    sourceId: string,
    targetId: string,
    adminId: string,
    sellerProfile: any,
    sourceProduct: any,
    targetProduct: any,
  ): Promise<any[]> {
    const mappingsCreated: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      const sellerId = sourceProduct.sellerId;

      if (sourceProduct.hasVariants && sourceProduct.variants.length > 0) {
        const targetVariants = await tx.productVariant.findMany({
          where: { productId: targetId, isDeleted: false },
          select: { id: true, price: true, stock: true },
        });

        if (targetVariants.length > 0) {
          for (const tv of targetVariants) {
            const mapping = await tx.sellerProductMapping.create({
              data: {
                sellerId, productId: targetId, variantId: tv.id,
                stockQty: 0,
                settlementPrice: tv.price ? Number(tv.price) : undefined,
                pickupAddress: sellerProfile?.storeAddress || null,
                pickupPincode: sellerProfile?.sellerZipCode || null,
                dispatchSla: 2, isActive: true,
              },
            });
            mappingsCreated.push(mapping);
          }
        } else {
          const mapping = await tx.sellerProductMapping.create({
            data: {
              sellerId, productId: targetId, variantId: null,
              stockQty: sourceProduct.baseStock ?? 0,
              settlementPrice: sourceProduct.basePrice ? Number(sourceProduct.basePrice) : undefined,
              pickupAddress: sellerProfile?.storeAddress || null,
              pickupPincode: sellerProfile?.sellerZipCode || null,
              dispatchSla: 2, isActive: true,
            },
          });
          mappingsCreated.push(mapping);
        }
      } else {
        const mapping = await tx.sellerProductMapping.create({
          data: {
            sellerId, productId: targetId, variantId: null,
            stockQty: sourceProduct.baseStock ?? 0,
            settlementPrice: sourceProduct.basePrice ? Number(sourceProduct.basePrice) : undefined,
            pickupAddress: sellerProfile?.storeAddress || null,
            pickupPincode: sellerProfile?.sellerZipCode || null,
            dispatchSla: 2, isActive: true,
          },
        });
        mappingsCreated.push(mapping);
      }

      await tx.product.update({
        where: { id: sourceId },
        data: { isDeleted: true, deletedAt: new Date(), status: 'ARCHIVED' },
      });
      await tx.productVariant.updateMany({
        where: { productId: sourceId },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      await tx.productStatusHistory.create({
        data: {
          productId: sourceId, fromStatus: sourceProduct.status, toStatus: 'ARCHIVED',
          changedBy: adminId, reason: `Merged into product ${targetId}`,
        },
      });
    });

    return mappingsCreated;
  }

  async findProductForMerge(productId: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      include: {
        variants: { where: { isDeleted: false }, select: { id: true, price: true, stock: true } },
      },
    });
  }

  async findDuplicateInfo(productId: string): Promise<any | null> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      select: { potentialDuplicateOf: true },
    });
    if (!product || !product.potentialDuplicateOf) return product;

    // Stale data guard: if the stored duplicate points at the product itself,
    // treat it as no duplicate so we don't render a self-match warning.
    if (product.potentialDuplicateOf === productId) {
      return { potentialDuplicateOf: null };
    }

    const duplicate = await this.prisma.product.findFirst({
      where: { id: product.potentialDuplicateOf, isDeleted: false },
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 3 },
        seller: { select: { id: true, sellerName: true, sellerShopName: true } },
      },
    });

    return { potentialDuplicateOf: product.potentialDuplicateOf, duplicate };
  }

  async findBySlug(slug: string): Promise<any | null> {
    return this.prisma.product.findUnique({ where: { slug }, select: { id: true } });
  }

  async findByIdAndSeller(productId: string, sellerId: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, sellerId, isDeleted: false },
      select: { id: true },
    });
  }

  async generateNextProductCode(): Promise<string> {
    const sequence = await this.prisma.$transaction(async (tx) => {
      return tx.productCodeSequence.upsert({
        where: { id: 1 },
        create: { id: 1, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
    });
    return `PRD-${String(sequence.lastNumber).padStart(6, '0')}`;
  }

  async findSellerByEmail(email: string): Promise<any | null> {
    return this.prisma.seller.findUnique({
      where: { email },
      select: { id: true, status: true },
    });
  }

  async findSellerById(sellerId: string): Promise<any | null> {
    return this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, status: true, isEmailVerified: true, storeAddress: true, sellerZipCode: true },
    });
  }

  async findOrCreateCategory(name: string): Promise<any> {
    const trimmed = name.trim();
    let category = await this.prisma.category.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (!category) {
      const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      category = await this.prisma.category.create({ data: { name: trimmed, slug } });
    }
    return category;
  }

  async findOrCreateBrand(name: string): Promise<any> {
    const trimmed = name.trim();
    let brand = await this.prisma.brand.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (!brand) {
      const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      brand = await this.prisma.brand.create({ data: { name: trimmed, slug } });
    }
    return brand;
  }
}
