import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FranchiseInventoryRepository } from '../../domain/repositories/franchise-inventory.repository.interface';
import { BadRequestAppException } from '../../../../core/exceptions';
import { InventoryMovementType, Prisma } from '@prisma/client';

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
    const skip = (params.page - 1) * params.limit;

    let stocks: any[];
    let total: number;

    if (params.lowStockOnly) {
      // Phase 159o (audit #13) — the low-stock predicate (availableQty <=
      // lowStockThreshold) is a column-to-column comparison Prisma's typed
      // `where` can't express. The previous code fetched a PAGE of ALL stock
      // (franchiseId only) and filtered it in JS, which (a) made pagination
      // meaningless — a 20-row page might surface 2 low-stock items — and
      // (b) reported `total` as the current page's match count, so the
      // dashboard pager and the "low stock" KPI were both wrong. The
      // field-reference `where.AND` that was built here was dead code: the
      // findMany/count below never used it. Do the comparison, pagination,
      // and count at the database via parameterised raw SQL instead.
      const searchClause = params.search
        ? Prisma.sql`AND (global_sku ILIKE ${'%' + params.search + '%'} OR franchise_sku ILIKE ${'%' + params.search + '%'})`
        : Prisma.empty;

      stocks = await this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT
          id,
          franchise_id        AS "franchiseId",
          product_id          AS "productId",
          variant_id          AS "variantId",
          global_sku          AS "globalSku",
          franchise_sku       AS "franchiseSku",
          on_hand_qty         AS "onHandQty",
          reserved_qty        AS "reservedQty",
          available_qty       AS "availableQty",
          damaged_qty         AS "damagedQty",
          in_transit_qty      AS "inTransitQty",
          low_stock_threshold AS "lowStockThreshold",
          last_restocked_at   AS "lastRestockedAt",
          created_at          AS "createdAt",
          updated_at          AS "updatedAt"
        FROM franchise_stock
        WHERE franchise_id = ${franchiseId}
          AND available_qty <= low_stock_threshold
          ${searchClause}
        ORDER BY available_qty ASC
        LIMIT ${params.limit} OFFSET ${skip}
      `);

      const countRows = await this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM franchise_stock
        WHERE franchise_id = ${franchiseId}
          AND available_qty <= low_stock_threshold
          ${searchClause}
      `);
      total = Number(countRows[0]?.count ?? 0);
    } else {
      const where: any = { franchiseId };
      if (params.search) {
        where.OR = [
          { globalSku: { contains: params.search, mode: 'insensitive' } },
          { franchiseSku: { contains: params.search, mode: 'insensitive' } },
        ];
      }
      const [rows, count] = await this.prisma.$transaction([
        this.prisma.franchiseStock.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take: params.limit,
        }),
        this.prisma.franchiseStock.count({ where }),
      ]);
      stocks = rows;
      total = count;
    }

    // Enrich with product data
    const productIds = stocks.map((s: any) => s.productId);
    const variantIds = stocks
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

    const enrichedStocks = stocks.map((stock: any) => ({
      ...stock,
      product: productMap.get(stock.productId) || null,
      variant: stock.variantId ? variantMap.get(stock.variantId) || null : null,
    }));

    return {
      stocks: enrichedStocks,
      total,
    };
  }

  async findLowStockItems(franchiseId: string): Promise<any[]> {
    // Phase 159o (audit #13) — filter at the DATABASE, not in JS. Prisma's
    // typed `where` can't compare two columns (availableQty <= lowStockThreshold),
    // so the old code pulled EVERY stock row for the franchise into memory and
    // filtered with Array.filter — unbounded heap growth for a franchise with
    // thousands of SKUs, on a hot dashboard endpoint. A parameterised $queryRaw
    // does the column-to-column comparison server-side and returns only the
    // rows that are actually low. Columns are aliased back to camelCase so the
    // enrichment below and the response shape are unchanged. LIMIT is a safety
    // bound; the full paginated list is available via the stock-overview
    // endpoint's `lowStockOnly` filter.
    const lowStockItems = await this.prisma.$queryRaw<any[]>`
      SELECT
        id,
        franchise_id        AS "franchiseId",
        product_id          AS "productId",
        variant_id          AS "variantId",
        global_sku          AS "globalSku",
        franchise_sku       AS "franchiseSku",
        on_hand_qty         AS "onHandQty",
        reserved_qty        AS "reservedQty",
        available_qty       AS "availableQty",
        damaged_qty         AS "damagedQty",
        in_transit_qty      AS "inTransitQty",
        low_stock_threshold AS "lowStockThreshold",
        last_restocked_at   AS "lastRestockedAt",
        created_at          AS "createdAt",
        updated_at          AS "updatedAt"
      FROM franchise_stock
      WHERE franchise_id = ${franchiseId}
        AND available_qty <= low_stock_threshold
      ORDER BY available_qty ASC
      LIMIT 500
    `;

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

  async adjustStockWithLedger(
    params: {
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
    },
    txParam?: Prisma.TransactionClient,
  ): Promise<{ stock: any; ledgerEntry: any }> {
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

    // Phase 55 (2026-05-21) — accept an outer transaction so callers
    // (e.g. procurement.confirmReceipt) can compose this call into a
    // larger atomic unit. When `tx` is passed we use it; otherwise
    // we open our own.
    const runIn = async (tx: Prisma.TransactionClient) => {
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
      } else {
        // Phase 55 — SELECT … FOR UPDATE row lock so concurrent POS
        // sale + procurement receipt can't tear-write the
        // read-modify-write below. Re-read under the lock to pick up
        // any change that committed between the unlocked findFirst
        // and the lock acquisition.
        await tx.$queryRaw`
          SELECT id FROM franchise_stock
          WHERE id = ${stock.id}
          FOR UPDATE
        `;
        const locked = await tx.franchiseStock.findUnique({
          where: { id: stock.id },
        });
        if (locked) stock = locked;
      }

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

      // Phase 159o (audit #1) — close the over-reservation race. The FOR UPDATE
      // above serialises concurrent reservations, but the validation block only
      // guarded the onHand path; a reservedQty increment that drove
      // availableQty negative (reserved > onHand) slipped through, letting two
      // concurrent reserves both pass the (unlocked) service pre-check and
      // oversell. Re-validate availableQty here, under the lock.
      if (updateField === 'reservedQty' && newAvailableQty < 0) {
        throw new BadRequestAppException(
          `Insufficient available stock to reserve: on-hand ${stock.onHandQty}, would reserve ${afterQty}`,
        );
      }

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
    };
    if (txParam) return runIn(txParam);
    return this.prisma.$transaction(runIn);
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
