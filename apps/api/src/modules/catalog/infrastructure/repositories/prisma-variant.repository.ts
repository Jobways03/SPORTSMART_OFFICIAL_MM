import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { IVariantRepository } from '../../domain/repositories/variant.repository.interface';

@Injectable()
export class PrismaVariantRepository implements IVariantRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Phase 4.6 (2026-05-16) — pagination.
   *
   * Loading every variant of a product in one shot via `include`
   * triggers an N+1 fetch through optionValues → optionValue →
   * optionDefinition for each variant. For a product with 500 variants
   * × 3 option dimensions each, that's 1500+ joins per call. The
   * legacy signature stays for back-compat (it routes through
   * findPageByProductId with a default page size), but callers should
   * migrate to the paginated method for admin lists.
   */
  async findByProductId(productId: string): Promise<any[]> {
    // Default to 200/variant cap when callers haven't migrated to
    // pagination yet. Most products have far fewer than 200 variants;
    // the ones that exceed this are admin-only and need the
    // paginated path anyway.
    const { items } = await this.findPageByProductId(productId, {
      page: 1,
      limit: 200,
    });
    return items;
  }

  async findPageByProductId(
    productId: string,
    opts: { page: number; limit: number },
  ): Promise<{ items: any[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, opts.page);
    const limit = Math.min(Math.max(1, opts.limit), 500);
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { productId, isDeleted: false },
        include: {
          optionValues: {
            include: {
              optionValue: { include: { optionDefinition: true } },
            },
          },
          images: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { sortOrder: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.productVariant.count({
        where: { productId, isDeleted: false },
      }),
    ]);
    return { items, total, page, limit };
  }

  async findById(variantId: string, productId: string): Promise<any | null> {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
    });
  }

  async findByIdWithProduct(variantId: string): Promise<any | null> {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, isDeleted: false },
      include: { product: true },
    });
  }

  async findVariantSnapshotForOrder(variantId: string): Promise<any | null> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, isDeleted: false },
      include: {
        product: {
          include: {
            images: {
              where: { isPrimary: true },
              take: 1,
            },
            category: { select: { id: true, name: true } },
            brand: { select: { id: true, name: true } },
          },
        },
        optionValues: {
          include: {
            optionValue: {
              include: { optionDefinition: true },
            },
          },
        },
      },
    });

    if (!variant) return null;

    const primaryImage =
      variant.product.images.length > 0
        ? variant.product.images[0]!.url
        : null;

    return {
      productId: variant.product.id,
      variantId: variant.id,
      title: variant.product.title,
      variantTitle: variant.title,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      sku: variant.sku || variant.product.baseSku,
      imageUrl: primaryImage,
      categoryName: variant.product.category?.name || null,
      brandName: variant.product.brand?.name || null,
      sellerId: variant.product.sellerId,
      weight: variant.weight || variant.product.weight,
      weightUnit: variant.weightUnit || variant.product.weightUnit,
      options: variant.optionValues.map((ov: any) => ({
        name: ov.optionValue.optionDefinition.displayName,
        value: ov.optionValue.displayValue,
      })),
    };
  }

  async findLastSortOrder(productId: string): Promise<number | null> {
    const last = await this.prisma.productVariant.findFirst({
      where: { productId, isDeleted: false },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return last?.sortOrder ?? null;
  }

  async create(data: any): Promise<any> {
    // Phase 4.6 (2026-05-16) — per-product SKU uniqueness guard.
    // The schema doesn't carry `@@unique([productId, sku])` (would
    // require a migration); we enforce it at the repo boundary so
    // imports + admin edits can't introduce duplicates that would
    // crash the inventory lookup at checkout. NULL SKUs are allowed
    // (mappings without a real SKU are valid for digital goods).
    if (data?.sku && data?.productId) {
      const existing = await this.prisma.productVariant.findFirst({
        where: {
          productId: data.productId,
          sku: data.sku,
          isDeleted: false,
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `SKU "${data.sku}" is already used by another variant on this product`,
        );
      }
    }
    return this.prisma.productVariant.create({
      data,
      include: {
        optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async update(variantId: string, data: any): Promise<any> {
    // SKU uniqueness re-check on updates that change the SKU.
    if (data?.sku) {
      const current = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { productId: true, sku: true },
      });
      // Only re-check if the SKU is actually changing.
      if (current && current.sku !== data.sku) {
        const conflict = await this.prisma.productVariant.findFirst({
          where: {
            productId: current.productId,
            sku: data.sku,
            isDeleted: false,
            NOT: { id: variantId },
          },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictException(
            `SKU "${data.sku}" is already used by another variant on this product`,
          );
        }
      }
    }
    return this.prisma.productVariant.update({
      where: { id: variantId },
      data,
      include: {
        optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async softDelete(variantId: string): Promise<void> {
    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  async bulkUpdate(updates: Array<{ id: string; data: any }>): Promise<any[]> {
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const item of updates) {
        const variant = await tx.productVariant.update({
          where: { id: item.id },
          data: item.data,
        });
        results.push(variant);
      }
      return results;
    });
  }

  async findOptionValuesByIds(ids: string[]): Promise<any[]> {
    return this.prisma.optionValue.findMany({
      where: { id: { in: ids } },
      include: { optionDefinition: true },
    });
  }

  async findOrCreateOptionDefinition(name: string): Promise<any> {
    let definition = await this.prisma.optionDefinition.findUnique({ where: { name } });
    if (!definition) {
      definition = await this.prisma.optionDefinition.create({
        data: { name, displayName: name },
      });
    }
    return definition;
  }

  async findOrCreateOptionValue(definitionId: string, value: string, sortOrder: number): Promise<any> {
    let optionValue = await this.prisma.optionValue.findUnique({
      where: { optionDefinitionId_value: { optionDefinitionId: definitionId, value } },
    });
    if (!optionValue) {
      optionValue = await this.prisma.optionValue.create({
        data: { optionDefinitionId: definitionId, value, displayValue: value, sortOrder },
      });
    }
    return optionValue;
  }

  async clearProductOptionsAndVariants(productId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productVariantOptionValue.deleteMany({ where: { variant: { productId } } });
      await tx.productVariant.deleteMany({ where: { productId } });
      await tx.productOptionValue.deleteMany({ where: { productId } });
      await tx.productOption.deleteMany({ where: { productId } });
    });
  }

  async createProductOption(productId: string, definitionId: string, sortOrder: number): Promise<void> {
    await this.prisma.productOption.create({
      data: { productId, optionDefinitionId: definitionId, sortOrder },
    });
  }

  async createProductOptionValue(productId: string, optionValueId: string): Promise<void> {
    await this.prisma.productOptionValue.create({
      data: { productId, optionValueId },
    });
  }

  async setHasVariants(productId: string, hasVariants: boolean): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: { hasVariants },
    });
  }
}
