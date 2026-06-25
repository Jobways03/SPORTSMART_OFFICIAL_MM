import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  InventoryManagementRepository,
  MappingBasic,
  MappingRecord,
  MappingForAggregation,
  MappingStockInfo,
  StockAggResult,
  VariantLookup,
  ProductLookup,
  ReservationWithMapping,
  StockMovementRow,
} from '../../domain/repositories/inventory-management.repository.interface';
import { SellerType } from '../../../../core/authorization/seller-scope';

@Injectable()
export class PrismaInventoryManagementRepository implements InventoryManagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Stock adjustment ────────────────────────────────────────────── */

  async findMappingById(mappingId: string): Promise<MappingBasic | null> {
    const result = await this.prisma.sellerProductMapping.findUnique({
      where: { id: mappingId },
    });
    if (!result) return null;
    return {
      id: result.id,
      sellerId: result.sellerId,
      productId: result.productId,
      variantId: result.variantId,
      stockQty: result.stockQty,
      reservedQty: result.reservedQty,
    };
  }

  async updateMappingStock(mappingId: string, newStockQty: number): Promise<MappingBasic> {
    const result = await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: { stockQty: newStockQty },
    });
    return {
      id: result.id,
      sellerId: result.sellerId,
      productId: result.productId,
      variantId: result.variantId,
      stockQty: result.stockQty,
      reservedQty: result.reservedQty,
    };
  }

  /* ── Low stock queries ───────────────────────────────────────────── */

  async findActiveMappingsForSeller(sellerId: string): Promise<MappingRecord[]> {
    const results = await this.prisma.sellerProductMapping.findMany({
      where: { sellerId, isActive: true },
      include: {
        seller: { select: { id: true, sellerName: true, sellerShopName: true } },
        product: { select: { id: true, title: true, productCode: true } },
        variant: { select: { id: true, sku: true, masterSku: true } },
      },
      orderBy: { stockQty: 'asc' },
    });

    return results.map((m) => ({
      id: m.id,
      sellerId: m.sellerId,
      productId: m.productId,
      variantId: m.variantId,
      stockQty: m.stockQty,
      reservedQty: m.reservedQty,
      lowStockThreshold: m.lowStockThreshold,
      isActive: m.isActive,
      seller: m.seller,
      product: m.product,
      variant: m.variant,
    }));
  }

  async findAllActiveMappings(
    sellerId?: string,
    allowedSellerTypes?: SellerType[],
  ): Promise<MappingRecord[]> {
    const where: any = { isActive: true };
    if (sellerId) where.sellerId = sellerId;
    if (allowedSellerTypes?.length)
      where.seller = { sellerType: { in: allowedSellerTypes } };

    const results = await this.prisma.sellerProductMapping.findMany({
      where,
      include: {
        seller: { select: { id: true, sellerName: true, sellerShopName: true } },
        product: { select: { id: true, title: true, productCode: true } },
        variant: { select: { id: true, sku: true, masterSku: true } },
      },
      orderBy: { stockQty: 'asc' },
    });

    return results.map((m) => ({
      id: m.id,
      sellerId: m.sellerId,
      productId: m.productId,
      variantId: m.variantId,
      stockQty: m.stockQty,
      reservedQty: m.reservedQty,
      lowStockThreshold: m.lowStockThreshold,
      isActive: m.isActive,
      seller: m.seller,
      product: m.product,
      variant: m.variant,
    }));
  }

  /* ── Out-of-stock ────────────────────────────────────────────────── */

  async findActiveMappingsForAggregation(
    allowedSellerTypes?: SellerType[],
  ): Promise<MappingForAggregation[]> {
    const where: any = { isActive: true };
    if (allowedSellerTypes?.length)
      where.seller = { sellerType: { in: allowedSellerTypes } };
    const results = await this.prisma.sellerProductMapping.findMany({
      where,
      include: {
        product: { select: { id: true, title: true, productCode: true, hasVariants: true } },
        variant: { select: { id: true, sku: true, masterSku: true } },
      },
    });

    return results.map((m) => ({
      productId: m.productId,
      variantId: m.variantId,
      stockQty: m.stockQty,
      reservedQty: m.reservedQty,
      product: m.product,
      variant: m.variant,
    }));
  }

  /* ── Stock import ────────────────────────────────────────────────── */

  async findVariantsByMasterSkus(skus: string[]): Promise<VariantLookup[]> {
    return this.prisma.productVariant.findMany({
      where: { masterSku: { in: skus }, isDeleted: false },
      select: { id: true, masterSku: true, productId: true },
    });
  }

  async findProductsByProductCodes(codes: string[]): Promise<ProductLookup[]> {
    return this.prisma.product.findMany({
      where: { productCode: { in: codes }, isDeleted: false },
      select: { id: true, productCode: true },
    });
  }

  async findSellerMappingByProductVariant(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<MappingBasic | null> {
    const result = await this.prisma.sellerProductMapping.findFirst({
      where: { sellerId, productId, variantId },
    });
    if (!result) return null;
    return {
      id: result.id,
      sellerId: result.sellerId,
      productId: result.productId,
      variantId: result.variantId,
      stockQty: result.stockQty,
      reservedQty: result.reservedQty,
    };
  }

  async setMappingStockQty(mappingId: string, stockQty: number): Promise<void> {
    await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: { stockQty },
    });
  }

  /* ── Overview ────────────────────────────────────────────────────── */

  async countDistinctMappedProducts(allowedSellerTypes?: SellerType[]): Promise<number> {
    const where: any = { isActive: true };
    if (allowedSellerTypes?.length)
      where.seller = { sellerType: { in: allowedSellerTypes } };
    const result = await this.prisma.sellerProductMapping.findMany({
      where,
      select: { productId: true },
      distinct: ['productId'],
    });
    return result.length;
  }

  async countDistinctMappedVariants(allowedSellerTypes?: SellerType[]): Promise<number> {
    const where: any = { isActive: true, variantId: { not: null } };
    if (allowedSellerTypes?.length)
      where.seller = { sellerType: { in: allowedSellerTypes } };
    const result = await this.prisma.sellerProductMapping.findMany({
      where,
      select: { variantId: true },
      distinct: ['variantId'],
    });
    return result.length;
  }

  async aggregateActiveStock(allowedSellerTypes?: SellerType[]): Promise<StockAggResult> {
    const where: any = { isActive: true };
    if (allowedSellerTypes?.length)
      where.seller = { sellerType: { in: allowedSellerTypes } };
    const result = await this.prisma.sellerProductMapping.aggregate({
      where,
      _sum: { stockQty: true, reservedQty: true },
    });
    return {
      totalStockQty: result._sum.stockQty ?? 0,
      totalReservedQty: result._sum.reservedQty ?? 0,
    };
  }

  async findAllActiveMappingStockInfo(
    allowedSellerTypes?: SellerType[],
  ): Promise<MappingStockInfo[]> {
    const where: any = { isActive: true };
    if (allowedSellerTypes?.length)
      where.seller = { sellerType: { in: allowedSellerTypes } };
    return this.prisma.sellerProductMapping.findMany({
      where,
      select: { stockQty: true, reservedQty: true, lowStockThreshold: true },
    });
  }

  /* ── Reservations ────────────────────────────────────────────────── */

  async findActiveReservations(
    page: number,
    limit: number,
    filters?: {
      mappingId?: string;
      orderId?: string;
      allowedSellerTypes?: SellerType[];
    },
  ): Promise<{ reservations: ReservationWithMapping[]; total: number }> {
    const where: any = { status: 'RESERVED' };
    if (filters?.mappingId) where.mappingId = filters.mappingId;
    if (filters?.orderId) where.orderId = filters.orderId;
    if (filters?.allowedSellerTypes?.length)
      where.mapping = {
        seller: { sellerType: { in: filters.allowedSellerTypes } },
      };

    const [reservations, total] = await Promise.all([
      this.prisma.stockReservation.findMany({
        where,
        include: {
          mapping: {
            include: {
              seller: { select: { id: true, sellerName: true, sellerShopName: true } },
              product: { select: { id: true, title: true, productCode: true } },
              variant: { select: { id: true, sku: true, masterSku: true } },
            },
          },
        },
        orderBy: { expiresAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockReservation.count({ where }),
    ]);

    return {
      reservations: reservations.map((r) => ({
        id: r.id,
        mappingId: r.mappingId,
        quantity: r.quantity,
        status: r.status,
        orderId: r.orderId,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        mapping: {
          seller: r.mapping.seller,
          product: r.mapping.product,
          variant: r.mapping.variant,
        },
      })),
      total,
    };
  }

  /* ── Stock movement audit ──────────────────────────────────────── */

  async findMovementsByMappingId(
    mappingId: string,
    page: number,
    limit: number,
  ): Promise<{ movements: StockMovementRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { mappingId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockMovement.count({ where: { mappingId } }),
    ]);
    return {
      movements: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        quantityDelta: r.quantityDelta,
        beforeStockQty: r.beforeStockQty,
        afterStockQty: r.afterStockQty,
        beforeReservedQty: r.beforeReservedQty,
        afterReservedQty: r.afterReservedQty,
        reason: r.reason,
        referenceType: r.referenceType,
        referenceId: r.referenceId,
        actorId: r.actorId,
        actorRole: r.actorRole,
        createdAt: r.createdAt,
      })),
      total,
    };
  }
}
