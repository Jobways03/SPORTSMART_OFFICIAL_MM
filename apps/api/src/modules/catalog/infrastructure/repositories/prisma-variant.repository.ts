import { Injectable, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { IVariantRepository, RepoTx } from '../../domain/repositories/variant.repository.interface';

type PrismaLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PrismaVariantRepository implements IVariantRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: RepoTx): PrismaLike {
    return tx ?? this.prisma;
  }

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
          images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
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
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
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
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
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

  /**
   * Phase 41 (2026-05-21) — atomic upsert. Pre-Phase-41 a concurrent
   * /generate-manual with the same option name could create duplicate
   * OptionDefinition rows; with the upsert keyed on the natural unique
   * (name), a concurrent insert collapses to a single row.
   */
  async findOrCreateOptionDefinition(name: string): Promise<any> {
    return this.prisma.optionDefinition.upsert({
      where: { name },
      update: {},
      create: { name, displayName: name },
    });
  }

  async findOrCreateOptionValue(definitionId: string, value: string, sortOrder: number): Promise<any> {
    return this.prisma.optionValue.upsert({
      where: { optionDefinitionId_value: { optionDefinitionId: definitionId, value } },
      update: {},
      create: { optionDefinitionId: definitionId, value, displayValue: value, sortOrder },
    });
  }

  /**
   * Phase 41 (2026-05-21) — returns the publicIds of every variant
   * image about to be wiped so the controller can fire-and-forget
   * delete them on media after the transaction commits. Closes
   * audit gap #16 (asset leak on /generate re-runs).
   */
  async collectVariantImagePublicIds(productId: string): Promise<string[]> {
    const rows = await this.prisma.productVariantImage.findMany({
      where: { variant: { productId } },
      select: { publicId: true },
    });
    return rows.map((r) => r.publicId).filter((p): p is string => !!p);
  }

  async clearProductOptionsAndVariants(productId: string, tx?: RepoTx): Promise<void> {
    // Phase 42 (2026-05-21) — when called inside an outer tx, reuse it
    // so the four deletes share the parent's atomicity. Otherwise open
    // a local transaction (legacy behaviour for callers that haven't
    // migrated to the outer-tx pattern).
    const exec = async (db: PrismaLike) => {
      await db.productVariantOptionValue.deleteMany({ where: { variant: { productId } } });
      await db.productVariant.deleteMany({ where: { productId } });
      await db.productOptionValue.deleteMany({ where: { productId } });
      await db.productOption.deleteMany({ where: { productId } });
    };
    if (tx) {
      await exec(tx);
    } else {
      await this.prisma.$transaction(exec);
    }
  }

  /**
   * Phase 41 (2026-05-21) — guards used by the controller's /generate
   * confirmation flow. Returns the count of variants with active stock
   * and the count of cart items referencing variants on this product.
   * The controller refuses to overwrite when either is non-zero unless
   * the admin/seller passes ?confirm=true.
   */
  async countActiveVariantInventory(productId: string): Promise<{ withStock: number; cartItems: number }> {
    const [withStock, cartItems] = await Promise.all([
      this.prisma.productVariant.count({
        where: {
          productId,
          isDeleted: false,
          OR: [
            { stock: { gt: 0 } },
            { sellerMappings: { some: { isActive: true, stockQty: { gt: 0 } } } },
          ],
        },
      }),
      this.prisma.cartItem.count({
        where: { variant: { productId } },
      }),
    ]);
    return { withStock, cartItems };
  }

  async createProductOption(productId: string, definitionId: string, sortOrder: number, tx?: RepoTx): Promise<void> {
    await this.db(tx).productOption.create({
      data: { productId, optionDefinitionId: definitionId, sortOrder },
    });
  }

  async createProductOptionValue(productId: string, optionValueId: string, tx?: RepoTx): Promise<void> {
    await this.db(tx).productOptionValue.create({
      data: { productId, optionValueId },
    });
  }

  async setHasVariants(productId: string, hasVariants: boolean, tx?: RepoTx): Promise<void> {
    await this.db(tx).product.update({
      where: { id: productId },
      data: { hasVariants },
    });
  }
}
