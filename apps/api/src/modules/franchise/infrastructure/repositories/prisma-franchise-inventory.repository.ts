import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FranchiseInventoryRepository } from '../../domain/repositories/franchise-inventory.repository.interface';
import { BadRequestAppException } from '../../../../core/exceptions';
import { InventoryMovementType } from '@prisma/client';

@Injectable()
export class PrismaFranchiseInventoryRepository implements FranchiseInventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null> {
    return this.prisma.franchiseStock.findFirst({
      where: {
        franchiseId,
        productId,
        variantId: variantId ?? null,
      },
    });
  }

  async findStockByFranchise(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      search?: string;
      lowStockOnly?: boolean;
    },
  ): Promise<{ stocks: any[]; total: number }> {
    const where: any = { franchiseId };

    if (params.lowStockOnly) {
      // Filter where availableQty <= lowStockThreshold
      // Using raw condition since Prisma doesn't support field-to-field comparison directly
      where.AND = [
        {
          availableQty: {
            lte: this.prisma.franchiseStock.fields?.lowStockThreshold as any,
          },
        },
      ];
    }

    if (params.search) {
      where.OR = [
        { globalSku: { contains: params.search, mode: 'insensitive' } },
        { franchiseSku: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const skip = (params.page - 1) * params.limit;

    // Get stocks
    const [stocks, total] = await this.prisma.$transaction([
      this.prisma.franchiseStock.findMany({
        where: params.lowStockOnly
          ? {
              franchiseId,
              ...(params.search
                ? {
                    OR: [
                      { globalSku: { contains: params.search, mode: 'insensitive' } },
                      { franchiseSku: { contains: params.search, mode: 'insensitive' } },
                    ],
                  }
                : {}),
            }
          : where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchiseStock.count({
        where: params.lowStockOnly
          ? {
              franchiseId,
              ...(params.search
                ? {
                    OR: [
                      { globalSku: { contains: params.search, mode: 'insensitive' } },
                      { franchiseSku: { contains: params.search, mode: 'insensitive' } },
                    ],
                  }
                : {}),
            }
          : where,
      }),
    ]);

    // For low stock filtering (field-to-field), filter in memory
    let filteredStocks = stocks;
    if (params.lowStockOnly) {
      filteredStocks = stocks.filter(
        (s: any) => s.availableQty <= s.lowStockThreshold,
      );
    }

    // Enrich with product data
    const productIds = filteredStocks.map((s: any) => s.productId);
    const variantIds = filteredStocks
      .filter((s: any) => s.variantId)
      .map((s: any) => s.variantId);

    const [products, variants] = await Promise.all([
      productIds.length > 0
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: {
              id: true,
              title: true,
              baseSku: true,
              productCode: true,
              images: { where: { sortOrder: 0 }, take: 1 },
            },
          })
        : [],
      variantIds.length > 0
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              title: true,
              sku: true,
              masterSku: true,
            },
          })
        : [],
    ]);

    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const variantMap = new Map(variants.map((v: any) => [v.id, v]));

    const enrichedStocks = filteredStocks.map((stock: any) => ({
      ...stock,
      product: productMap.get(stock.productId) || null,
      variant: stock.variantId ? variantMap.get(stock.variantId) || null : null,
    }));

    return {
      stocks: enrichedStocks,
      total: params.lowStockOnly ? filteredStocks.length : total,
    };
  }

  async findLowStockItems(franchiseId: string): Promise<any[]> {
    const stocks = await this.prisma.franchiseStock.findMany({
      where: { franchiseId },
      orderBy: { availableQty: 'asc' },
    });

    // Filter where availableQty <= lowStockThreshold (field-to-field comparison)
    const lowStockItems = stocks.filter(
      (s: any) => s.availableQty <= s.lowStockThreshold,
    );

    // Enrich with product data
    const productIds = lowStockItems.map((s: any) => s.productId);
    const variantIds = lowStockItems
      .filter((s: any) => s.variantId)
      .map((s: any) => s.variantId);

    const [products, variants] = await Promise.all([
      productIds.length > 0
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: {
              id: true,
              title: true,
              baseSku: true,
              productCode: true,
              images: { where: { sortOrder: 0 }, take: 1 },
            },
          })
        : [],
      variantIds.length > 0
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              title: true,
              sku: true,
              masterSku: true,
            },
          })
        : [],
    ]);

    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const variantMap = new Map(variants.map((v: any) => [v.id, v]));

    return lowStockItems.map((stock: any) => ({
      ...stock,
      product: productMap.get(stock.productId) || null,
      variant: stock.variantId ? variantMap.get(stock.variantId) || null : null,
    }));
  }

  async upsertStock(data: {
    franchiseId: string;
    productId: string;
    variantId: string | null;
    globalSku: string;
    franchiseSku?: string | null;
    onHandQty: number;
    reservedQty: number;
    availableQty: number;
    damagedQty?: number;
    inTransitQty?: number;
    lowStockThreshold?: number;
  }): Promise<any> {
    const existing = await this.prisma.franchiseStock.findFirst({
      where: {
        franchiseId: data.franchiseId,
        productId: data.productId,
        variantId: data.variantId ?? null,
      },
    });

    if (existing) {
      return this.prisma.franchiseStock.update({
        where: { id: existing.id },
        data: {
          globalSku: data.globalSku,
          franchiseSku: data.franchiseSku,
          onHandQty: data.onHandQty,
          reservedQty: data.reservedQty,
          availableQty: data.availableQty,
          damagedQty: data.damagedQty ?? 0,
          inTransitQty: data.inTransitQty ?? 0,
          lowStockThreshold: data.lowStockThreshold ?? 5,
        },
      });
    }

    return this.prisma.franchiseStock.create({
      data: {
        franchiseId: data.franchiseId,
        productId: data.productId,
        variantId: data.variantId,
        globalSku: data.globalSku,
        franchiseSku: data.franchiseSku,
        onHandQty: data.onHandQty,
        reservedQty: data.reservedQty,
        availableQty: data.availableQty,
        damagedQty: data.damagedQty ?? 0,
        inTransitQty: data.inTransitQty ?? 0,
        lowStockThreshold: data.lowStockThreshold ?? 5,
      },
    });
  }

  async createLedgerEntry(data: {
    franchiseId: string;
    productId: string;
    variantId: string | null;
    globalSku: string;
    movementType: string;
    quantityDelta: number;
    referenceType: string;
    referenceId?: string;
    remarks?: string;
    beforeQty: number;
    afterQty: number;
    actorType: string;
    actorId?: string;
  }): Promise<any> {
    return this.prisma.franchiseInventoryLedger.create({
      data: {
        franchiseId: data.franchiseId,
        productId: data.productId,
        variantId: data.variantId,
        globalSku: data.globalSku,
        movementType: data.movementType as InventoryMovementType,
        quantityDelta: data.quantityDelta,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        remarks: data.remarks,
        beforeQty: data.beforeQty,
        afterQty: data.afterQty,
        actorType: data.actorType,
        actorId: data.actorId,
      },
    });
  }

  async findLedgerEntries(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      productId?: string;
      movementType?: string;
      referenceType?: string;
      fromDate?: Date;
      toDate?: Date;
    },
  ): Promise<{ entries: any[]; total: number }> {
    const where: any = { franchiseId };

    if (params.productId) {
      where.productId = params.productId;
    }

    if (params.movementType) {
      where.movementType = params.movementType as InventoryMovementType;
    }

    if (params.referenceType) {
      where.referenceType = params.referenceType;
    }

    if (params.fromDate || params.toDate) {
      where.createdAt = {};
      if (params.fromDate) {
        where.createdAt.gte = params.fromDate;
      }
      if (params.toDate) {
        where.createdAt.lte = params.toDate;
      }
    }

    const skip = (params.page - 1) * params.limit;

    const [entries, total] = await this.prisma.$transaction([
      this.prisma.franchiseInventoryLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchiseInventoryLedger.count({ where }),
    ]);

    return { entries, total };
  }

  async adjustStockWithLedger(params: {
    franchiseId: string;
    productId: string;
    variantId: string | null;
    globalSku: string;
    movementType: string;
    quantityDelta: number;
    referenceType: string;
    referenceId?: string;
    remarks?: string;
    actorType: string;
    actorId?: string;
    updateField: 'onHandQty' | 'reservedQty' | 'damagedQty' | 'inTransitQty';
  }): Promise<{ stock: any; ledgerEntry: any }> {
    const {
      franchiseId,
      productId,
      variantId,
      globalSku,
      movementType,
      quantityDelta,
      referenceType,
      referenceId,
      remarks,
      actorType,
      actorId,
      updateField,
    } = params;

    return this.prisma.$transaction(async (tx) => {
      // 1. Get or create stock record
      let stock = await tx.franchiseStock.findFirst({
        where: {
          franchiseId,
          productId,
          variantId: variantId ?? null,
        },
      });

      if (!stock) {
        stock = await tx.franchiseStock.create({
          data: {
            franchiseId,
            productId,
            variantId: variantId ?? null,
            globalSku,
            onHandQty: 0,
            reservedQty: 0,
            availableQty: 0,
            damagedQty: 0,
            inTransitQty: 0,
          },
        });
      }

      // 2. Record before qty
      const beforeQty = stock[updateField];
      const afterQty = beforeQty + quantityDelta;

      // 3. Validate — prevent negative stock
      if (updateField === 'onHandQty' && afterQty < stock.reservedQty) {
        throw new BadRequestAppException(
          'Cannot reduce on-hand below reserved quantity',
        );
      }
      if (afterQty < 0) {
        throw new BadRequestAppException(
          `Insufficient stock: ${updateField} would become ${afterQty}`,
        );
      }

      // 4. Update stock snapshot
      const newAvailableQty =
        updateField === 'onHandQty'
          ? afterQty - stock.reservedQty
          : updateField === 'reservedQty'
            ? stock.onHandQty - afterQty
            : stock.availableQty;

      const updateData: any = {
        [updateField]: afterQty,
        availableQty: newAvailableQty,
        updatedAt: new Date(),
      };

      if (movementType === 'PROCUREMENT_IN') {
        updateData.lastRestockedAt = new Date();
      }

      const updatedStock = await tx.franchiseStock.update({
        where: { id: stock.id },
        data: updateData,
      });

      // 5. Create immutable ledger entry
      const ledgerEntry = await tx.franchiseInventoryLedger.create({
        data: {
          franchiseId,
          productId,
          variantId: variantId ?? null,
          globalSku,
          movementType: movementType as InventoryMovementType,
          quantityDelta,
          referenceType,
          referenceId,
          remarks,
          beforeQty,
          afterQty,
          actorType,
          actorId,
        },
      });

      return { stock: updatedStock, ledgerEntry };
    });
  }

  async initializeStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    globalSku: string,
    franchiseSku?: string | null,
  ): Promise<any> {
    const existing = await this.prisma.franchiseStock.findFirst({
      where: {
        franchiseId,
        productId,
        variantId: variantId ?? null,
      },
    });

    if (existing) {
      return this.prisma.franchiseStock.update({
        where: { id: existing.id },
        data: {
          globalSku,
          ...(franchiseSku !== undefined ? { franchiseSku } : {}),
        },
      });
    }

    return this.prisma.franchiseStock.create({
      data: {
        franchiseId,
        productId,
        variantId: variantId ?? null,
        globalSku,
        franchiseSku: franchiseSku ?? null,
        onHandQty: 0,
        reservedQty: 0,
        availableQty: 0,
        damagedQty: 0,
        inTransitQty: 0,
      },
    });
  }
}
