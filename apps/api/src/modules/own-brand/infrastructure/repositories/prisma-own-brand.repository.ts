import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  OwnBrandProcurementOrder,
  OwnBrandProcurementStatus,
  OwnBrandStock,
  OwnBrandWarehouse,
  Product,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  CreateProcurementOrderInput,
  CreateWarehouseInput,
  OwnBrandProcurementOrderWithItems,
  OwnBrandProductListFilter,
  OwnBrandRepository,
  OwnBrandStockWithLocation,
  ProcurementListFilter,
  ReceiveProcurementInput,
  UpdateWarehouseInput,
} from '../../domain/repositories/own-brand.repository.interface';

@Injectable()
export class PrismaOwnBrandRepository implements OwnBrandRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Warehouses ─────────────────────────────────────────────────

  listWarehouses(activeOnly = false): Promise<OwnBrandWarehouse[]> {
    return this.prisma.ownBrandWarehouse.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { code: 'asc' },
    });
  }

  findWarehouseById(id: string): Promise<OwnBrandWarehouse | null> {
    return this.prisma.ownBrandWarehouse.findUnique({ where: { id } });
  }

  createWarehouse(input: CreateWarehouseInput): Promise<OwnBrandWarehouse> {
    return this.prisma.ownBrandWarehouse.create({ data: input });
  }

  updateWarehouse(id: string, data: UpdateWarehouseInput): Promise<OwnBrandWarehouse> {
    return this.prisma.ownBrandWarehouse.update({ where: { id }, data });
  }

  // ── Products ───────────────────────────────────────────────────

  async listOwnBrandProducts(filter: OwnBrandProductListFilter) {
    const { page, limit, search } = filter;
    const skip = (page - 1) * limit;
    const where: Prisma.ProductWhereInput = { productSource: 'OWN_BRAND' };
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { ownBrandSku: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  findProductById(id: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  async generateOwnBrandSku(): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        // Re-use the procurement sequence table for SKU minting too —
        // both produce monotonic per-tenant numbers and we don't want
        // yet another single-row counter table for SKUs.
        // Naming-wise NV-YYYY-NNNNNN keeps SKUs and POs visually distinct
        // (PO uses NV-PO-YYYY-NNNNNN).
        const seq = await tx.ownBrandProcurementSequence.upsert({
          where: { id: 1 },
          create: { id: 1, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const year = new Date().getFullYear();
        return `NV-${year}-${String(seq.lastNumber).padStart(6, '0')}`;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  setProductSource(args: {
    productId: string;
    source: 'SELLER' | 'OWN_BRAND';
    ownBrandSku: string | null;
  }): Promise<Product> {
    return this.prisma.product.update({
      where: { id: args.productId },
      data: {
        productSource: args.source,
        ownBrandSku: args.ownBrandSku,
      },
    });
  }

  // ── Stocks ─────────────────────────────────────────────────────

  async listStocks(args: {
    warehouseId?: string;
    productId?: string;
    lowStockOnly?: boolean;
  }): Promise<OwnBrandStockWithLocation[]> {
    const where: Prisma.OwnBrandStockWhereInput = {};
    if (args.warehouseId) where.warehouseId = args.warehouseId;
    if (args.productId) where.productId = args.productId;
    const rows = await this.prisma.ownBrandStock.findMany({
      where,
      include: { warehouse: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!args.lowStockOnly) return rows;
    // Low-stock filter applied in memory; Prisma can't compare two
    // columns of the same row in `where`. Volume here is tiny.
    return rows.filter((r) => r.stockQty - r.reservedQty <= r.lowStockThreshold);
  }

  async adjustStock(args: {
    warehouseId: string;
    productId: string;
    variantId?: string | null;
    delta: number;
    landedCost?: number | null;
    kind: import('@prisma/client').OwnBrandStockMovementKind;
    reason?: string | null;
    refType?: string | null;
    refId?: string | null;
    adminId?: string | null;
  }): Promise<OwnBrandStock> {
    const variantId = args.variantId ?? null;
    return this.prisma.$transaction(async (tx) => {
      // Look up first so we know whether to upsert with a baseline.
      // Using findFirst because Prisma's compound-unique typing rejects
      // null on the variantId leg even though our column is nullable.
      const existing = await tx.ownBrandStock.findFirst({
        where: {
          warehouseId: args.warehouseId,
          productId: args.productId,
          variantId,
        },
      });
      const newQty = (existing?.stockQty ?? 0) + args.delta;
      if (newQty < 0) {
        throw new Error(
          `Insufficient stock — current ${existing?.stockQty ?? 0}, delta ${args.delta}`,
        );
      }
      const stock = existing
        ? await tx.ownBrandStock.update({
            where: { id: existing.id },
            data: {
              stockQty: newQty,
              ...(args.landedCost != null
                ? { lastLandedCost: args.landedCost }
                : {}),
            },
          })
        : await tx.ownBrandStock.create({
            data: {
              warehouseId: args.warehouseId,
              productId: args.productId,
              variantId,
              stockQty: newQty,
              ...(args.landedCost != null
                ? { lastLandedCost: args.landedCost }
                : {}),
            },
          });

      // Append-only ledger row — atomic with the stock update.
      await tx.ownBrandStockMovement.create({
        data: {
          warehouseId: args.warehouseId,
          productId: args.productId,
          variantId,
          kind: args.kind,
          delta: args.delta,
          stockAfter: newQty,
          reason: args.reason ?? null,
          refType: args.refType ?? null,
          refId: args.refId ?? null,
          createdByAdminId: args.adminId ?? null,
        },
      });

      return stock;
    });
  }

  async listStockMovements(args: {
    warehouseId?: string;
    productId?: string;
    variantId?: string | null;
    kind?: import('@prisma/client').OwnBrandStockMovementKind;
    limit?: number;
  }): Promise<import('@prisma/client').OwnBrandStockMovement[]> {
    return this.prisma.ownBrandStockMovement.findMany({
      where: {
        warehouseId: args.warehouseId,
        productId: args.productId,
        variantId: args.variantId === undefined ? undefined : args.variantId,
        kind: args.kind,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(args.limit ?? 100, 500),
    });
  }

  async listReceiptsForPo(
    poId: string,
  ): Promise<import('@prisma/client').OwnBrandProcurementReceipt[]> {
    return this.prisma.ownBrandProcurementReceipt.findMany({
      where: { poId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getAvailableForProduct(
    productId: string,
    variantId?: string | null,
  ): Promise<number> {
    const rows = await this.prisma.ownBrandStock.findMany({
      where: {
        productId,
        variantId: variantId ?? null,
        warehouse: { isActive: true },
      },
      select: { stockQty: true, reservedQty: true },
    });
    return rows.reduce((sum, r) => sum + (r.stockQty - r.reservedQty), 0);
  }

  findWarehousesWithStock(
    productId: string,
    variantId?: string | null,
  ): Promise<OwnBrandStockWithLocation[]> {
    return this.prisma.ownBrandStock.findMany({
      where: {
        productId,
        variantId: variantId ?? null,
        warehouse: { isActive: true },
        stockQty: { gt: 0 },
      },
      include: { warehouse: true },
    });
  }

  // ── Procurement ────────────────────────────────────────────────

  async generateNextPoNumber(): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        const seq = await tx.ownBrandProcurementSequence.upsert({
          where: { id: 1 },
          create: { id: 1, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const year = new Date().getFullYear();
        return `NV-PO-${year}-${String(seq.lastNumber).padStart(6, '0')}`;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listProcurement(filter: ProcurementListFilter) {
    const { page, limit } = filter;
    const skip = (page - 1) * limit;
    const where: Prisma.OwnBrandProcurementOrderWhereInput = {};
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    if (filter.status) where.status = filter.status;
    if (filter.search?.trim()) {
      const q = filter.search.trim();
      where.OR = [
        { poNumber: { contains: q, mode: 'insensitive' } },
        { supplierName: { contains: q, mode: 'insensitive' } },
        { supplierReference: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (filter.fromDate || filter.toDate) {
      where.createdAt = {};
      if (filter.fromDate) where.createdAt.gte = filter.fromDate;
      if (filter.toDate) where.createdAt.lte = filter.toDate;
    }
    const [items, total] = await Promise.all([
      this.prisma.ownBrandProcurementOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ownBrandProcurementOrder.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async findProcurementById(
    id: string,
  ): Promise<OwnBrandProcurementOrderWithItems | null> {
    const po = await this.prisma.ownBrandProcurementOrder.findUnique({
      where: { id },
      include: { items: true, warehouse: true },
    });
    return po as OwnBrandProcurementOrderWithItems | null;
  }

  async createProcurement(
    input: CreateProcurementOrderInput,
  ): Promise<OwnBrandProcurementOrderWithItems> {
    const totalAmount = input.items.reduce(
      (sum, it) => sum + it.unitCost * it.quantityOrdered,
      0,
    );
    const created = await this.prisma.ownBrandProcurementOrder.create({
      data: {
        poNumber: input.poNumber,
        warehouseId: input.warehouseId,
        supplierName: input.supplierName,
        expectedDate: input.expectedDate ?? null,
        supplierReference: input.supplierReference ?? null,
        notes: input.notes ?? null,
        totalAmount,
        createdByAdminId: input.createdByAdminId ?? null,
        items: {
          create: input.items.map((it) => ({
            productId: it.productId,
            variantId: it.variantId ?? null,
            productTitle: it.productTitle,
            variantTitle: it.variantTitle ?? null,
            ownBrandSku: it.ownBrandSku ?? null,
            quantityOrdered: it.quantityOrdered,
            unitCost: it.unitCost,
            lineTotal: it.unitCost * it.quantityOrdered,
          })),
        },
      },
      include: { items: true, warehouse: true },
    });
    return created as OwnBrandProcurementOrderWithItems;
  }

  async setProcurementStatus(args: {
    id: string;
    status: OwnBrandProcurementStatus;
    receivedAt?: Date | null;
  }): Promise<OwnBrandProcurementOrder> {
    return this.prisma.ownBrandProcurementOrder.update({
      where: { id: args.id },
      data: {
        status: args.status,
        ...(args.receivedAt !== undefined ? { receivedAt: args.receivedAt } : {}),
      },
    });
  }

  async applyReceipt(
    input: ReceiveProcurementInput,
  ): Promise<OwnBrandProcurementOrderWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.ownBrandProcurementOrder.findUnique({
        where: { id: input.poId },
        include: { items: true },
      });
      if (!po) throw new Error('Procurement order not found');
      if (po.status !== 'PLACED' && po.status !== 'IN_TRANSIT') {
        throw new Error(`PO must be PLACED or IN_TRANSIT to receive (got ${po.status})`);
      }

      // Apply per-item receipts
      for (const r of input.receipts) {
        const item = po.items.find((i) => i.id === r.itemId);
        if (!item) throw new Error(`PO item ${r.itemId} not found`);
        if (r.quantityReceived <= 0) continue;
        const newReceived = item.quantityReceived + r.quantityReceived;
        if (newReceived > item.quantityOrdered) {
          throw new Error(
            `Cannot receive more than ordered for item ${r.itemId} ` +
              `(ordered=${item.quantityOrdered}, already received=${item.quantityReceived})`,
          );
        }

        // Update item
        await tx.ownBrandProcurementOrderItem.update({
          where: { id: item.id },
          data: { quantityReceived: newReceived },
        });

        // Per-receipt audit row — preserves who/when/how-many for each
        // partial receipt. The PO item's `quantityReceived` is the
        // running sum of these rows.
        await tx.ownBrandProcurementReceipt.create({
          data: {
            poId: po.id,
            poItemId: item.id,
            quantityReceived: r.quantityReceived,
            notes: r.notes ?? null,
            receivedByAdminId: input.receivedByAdminId ?? null,
          },
        });

        // Credit stock (upsert) — findFirst sidesteps Prisma's null-on-
        // compound-unique typing limitation.
        const variantId = item.variantId ?? null;
        const existing = await tx.ownBrandStock.findFirst({
          where: {
            warehouseId: po.warehouseId,
            productId: item.productId,
            variantId,
          },
        });
        const unitCostNumber = Number(item.unitCost);
        const newStockQty = (existing?.stockQty ?? 0) + r.quantityReceived;
        if (existing) {
          await tx.ownBrandStock.update({
            where: { id: existing.id },
            data: {
              stockQty: newStockQty,
              lastLandedCost: unitCostNumber,
            },
          });
        } else {
          await tx.ownBrandStock.create({
            data: {
              warehouseId: po.warehouseId,
              productId: item.productId,
              variantId,
              stockQty: newStockQty,
              lastLandedCost: unitCostNumber,
            },
          });
        }

        // Stock-movements ledger entry — RECEIPT kind, ref'd to the
        // PO so the movement is traceable from either side.
        await tx.ownBrandStockMovement.create({
          data: {
            warehouseId: po.warehouseId,
            productId: item.productId,
            variantId,
            kind: 'RECEIPT',
            delta: r.quantityReceived,
            stockAfter: newStockQty,
            reason: r.notes ?? `Received via PO ${po.poNumber}`,
            refType: 'procurement_order',
            refId: po.id,
            createdByAdminId: input.receivedByAdminId ?? null,
          },
        });
      }

      // If every item is now fully received, flip PO status to RECEIVED.
      const refreshed = await tx.ownBrandProcurementOrder.findUniqueOrThrow({
        where: { id: input.poId },
        include: { items: true },
      });
      const allReceived = refreshed.items.every(
        (i) => i.quantityReceived >= i.quantityOrdered,
      );
      if (allReceived && refreshed.status !== 'RECEIVED') {
        await tx.ownBrandProcurementOrder.update({
          where: { id: input.poId },
          data: { status: 'RECEIVED', receivedAt: new Date() },
        });
      } else if (refreshed.status === 'PLACED') {
        // Partial receipt: surface that goods are arriving.
        await tx.ownBrandProcurementOrder.update({
          where: { id: input.poId },
          data: { status: 'IN_TRANSIT' },
        });
      }

      const final = await tx.ownBrandProcurementOrder.findUniqueOrThrow({
        where: { id: input.poId },
        include: { items: true, warehouse: true },
      });
      return final as OwnBrandProcurementOrderWithItems;
    });
  }
}
