import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ISellerMappingRepository, SellerMappingListParams } from '../../domain/repositories/seller-mapping.repository.interface';
import { StockBelowReservedError } from '../../domain/errors/stock-below-reserved.error';

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
      where: {
        productId,
        OR: [
          { variantId: null },
          { variant: { isDeleted: false } },
        ],
      },
      include: {
        seller: { select: MAPPING_SELLER_SELECT },
        variant: { select: MAPPING_VARIANT_SELECT },
      },
      orderBy: { operationalPriority: 'desc' },
    });
  }

  async findAllPaginated(params: SellerMappingListParams): Promise<{ mappings: any[]; total: number }> {
    const { page, limit, sellerId, productId, isActive, approvalStatus, search } = params;
    const where: any = {
      // Exclude mappings for soft-deleted variants
      OR: [
        { variantId: null },
        { variant: { isDeleted: false } },
      ],
    };
    if (sellerId) where.sellerId = sellerId;
    if (productId) where.productId = productId;
    if (isActive !== undefined) where.isActive = isActive;
    if (approvalStatus) where.approvalStatus = approvalStatus;
    if (search) {
      where.AND = [
        {
          OR: [
            { product: { title: { contains: search, mode: 'insensitive' } } },
            { seller: { sellerName: { contains: search, mode: 'insensitive' } } },
            { seller: { sellerShopName: { contains: search, mode: 'insensitive' } } },
          ],
        },
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
    const where = {
      approvalStatus: 'PENDING_APPROVAL' as const,
      // Exclude mappings for soft-deleted variants
      OR: [
        { variantId: null },
        { variant: { isDeleted: false } },
      ],
    };
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
      select: { id: true, variantId: true },
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

  /**
   * Phase 1 (PR 1.10) — bulk stock-import floor.
   *
   * For each update, issue a status-conditional `updateMany`:
   *
   *   UPDATE seller_product_mappings
   *      SET stock_qty = $newStock
   *    WHERE id = $mappingId AND reserved_qty <= $newStock
   *
   * If the predicate fails (`reserved_qty > newStock`), `count` is 0
   * and the row is NOT written. We then re-read the row to extract its
   * current reservedQty and record a violation. After the loop, if any
   * violations were collected, we throw `StockBelowReservedError` from
   * inside the transaction callback — Prisma rolls back the rows we
   * already wrote, so the batch is all-or-nothing.
   *
   * Why per-row updateMany instead of one big WHERE-IN with a CASE
   * expression: each row has its own per-row predicate, and Prisma
   * doesn't expose a clean way to express that in a single statement.
   * The N round-trips are fine for the documented batch ceiling
   * (100 rows; see the controller's `if (dto.updates.length > 100)`).
   *
   * Why throw rather than return violations: a half-imported CSV is
   * harder to recover from than a clean rejection. Throwing inside
   * `$transaction` is the documented Prisma rollback mechanism.
   */
  async bulkUpdateStock(
    updates: Array<{ mappingId: string; stockQty: number }>,
  ): Promise<{
    updated: Array<{ id: string; stockQty: number; variantId: string | null; productId: string }>;
    violations: Array<{ mappingId: string; requestedStock: number; reservedQty: number }>;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const violations: Array<{ mappingId: string; requestedStock: number; reservedQty: number }> = [];
      const successIds: string[] = [];

      for (const update of updates) {
        const result = await tx.sellerProductMapping.updateMany({
          where: {
            id: update.mappingId,
            reservedQty: { lte: update.stockQty }, // floor enforced here
          },
          data: { stockQty: update.stockQty },
        });

        if (result.count === 0) {
          // Either the row was rejected by the floor predicate or
          // doesn't exist at all. Disambiguate so a missing row
          // doesn't masquerade as a floor violation (the controller's
          // existence/ownership check should have caught it already).
          const current = await tx.sellerProductMapping.findUnique({
            where: { id: update.mappingId },
            select: { id: true, reservedQty: true },
          });
          if (current) {
            violations.push({
              mappingId: update.mappingId,
              requestedStock: update.stockQty,
              reservedQty: current.reservedQty,
            });
          }
          // current === null: silently skip — controller's earlier
          // checks own existence validation, and treating it as a
          // violation would expose the wrong error to the seller.
        } else {
          successIds.push(update.mappingId);
        }
      }

      if (violations.length > 0) {
        // Roll back the writes already applied to earlier rows. The
        // controller catches this error and renders the violation list
        // to the seller.
        throw new StockBelowReservedError(violations);
      }

      const updated = await tx.sellerProductMapping.findMany({
        where: { id: { in: successIds } },
        select: { id: true, stockQty: true, variantId: true, productId: true },
      });
      return { updated, violations: [] };
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
            where: {
              sellerId,
              OR: [
                { variantId: null },
                { variant: { isDeleted: false } },
              ],
            },
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

  async setCodEligibility(sellerId: string, pincode: string, eligible: boolean): Promise<void> {
    await this.prisma.sellerServiceArea.update({
      where: { sellerId_pincode: { sellerId, pincode } },
      data: { codEligible: eligible },
    });
  }

  async findServiceArea(sellerId: string, pincode: string): Promise<any | null> {
    return this.prisma.sellerServiceArea.findUnique({
      where: { sellerId_pincode: { sellerId, pincode } },
    });
  }

  async autoRepairMissingMappingsForSeller(sellerId: string): Promise<number> {
    // Find products owned by this seller that have NO seller mappings
    const ownedWithoutMappings = await this.prisma.product.findMany({
      where: {
        sellerId,
        isDeleted: false,
        sellerMappings: { none: { sellerId } },
      },
      include: {
        variants: { where: { isDeleted: false }, select: { id: true, stock: true, price: true } },
        seller: { select: { storeAddress: true, sellerZipCode: true } },
      },
    });

    if (ownedWithoutMappings.length === 0) return 0;

    let totalCreated = 0;
    for (const product of ownedWithoutMappings) {
      const seller = product.seller;
      const variants = product.variants || [];

      if (product.hasVariants && variants.length > 0) {
        for (const variant of variants) {
          await this.prisma.sellerProductMapping.create({
            data: {
              sellerId,
              productId: product.id,
              variantId: variant.id,
              stockQty: variant.stock ?? 0,
              settlementPrice: variant.price ? Number(variant.price) : (product.basePrice ? Number(product.basePrice) : 0),
              pickupAddress: seller?.storeAddress || null,
              pickupPincode: seller?.sellerZipCode || null,
              dispatchSla: 2,
              approvalStatus: 'APPROVED',
              isActive: true,
            },
          });
          totalCreated++;
        }
      } else {
        await this.prisma.sellerProductMapping.create({
          data: {
            sellerId,
            productId: product.id,
            variantId: null,
            stockQty: product.baseStock ?? 0,
            settlementPrice: product.basePrice ? Number(product.basePrice) : 0,
            pickupAddress: seller?.storeAddress || null,
            pickupPincode: seller?.sellerZipCode || null,
            dispatchSla: 2,
            approvalStatus: 'APPROVED',
            isActive: true,
          },
        });
        totalCreated++;
      }
    }

    return totalCreated;
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
