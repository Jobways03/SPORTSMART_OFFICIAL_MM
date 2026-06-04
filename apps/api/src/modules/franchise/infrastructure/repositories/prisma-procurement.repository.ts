import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ProcurementRepository } from '../../domain/repositories/procurement.repository.interface';

@Injectable()
export class PrismaProcurementRepository implements ProcurementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<any | null> {
    return this.prisma.procurementRequest.findUnique({
      where: { id },
    });
  }

  async findByIdWithItems(id: string, tx?: Prisma.TransactionClient): Promise<any | null> {
    const client = tx ?? this.prisma;
    const request = await client.procurementRequest.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
        },
        franchise: {
          select: {
            id: true,
            franchiseCode: true,
            businessName: true,
            ownerName: true,
          },
        },
      },
    });

    if (!request) return null;

    // Hydrate each item with cost-prefill data so the admin approval
    // modal can fill landedUnitCost from the correct precedence chain:
    //
    //   per-franchise override  >  variant default  >  product default
    //
    // Cross-module FKs are intentionally scalar-only in this codebase,
    // so we do batched lookups instead of ORM includes. Runs N+1-safe:
    // three queries regardless of item count.
    const items = request.items as any[];
    const productIds = Array.from(
      new Set(items.map((i) => i.productId).filter(Boolean)),
    );
    const variantIds = Array.from(
      new Set(items.map((i) => i.variantId).filter((v): v is string => !!v)),
    );

    const [products, variants, franchisePrices] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            // procurementPrice drives the approval prefill fallback.
            // costPrice is display-only per product policy and is
            // intentionally NOT fetched here — it isn't used by
            // procurement logic.
            select: { id: true, title: true, procurementPrice: true },
          })
        : Promise.resolve([] as any[]),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, title: true, sku: true, procurementPrice: true },
          })
        : Promise.resolve([] as any[]),
      productIds.length
        ? this.prisma.franchiseProcurementPrice.findMany({
            where: {
              franchiseId: request.franchiseId,
              productId: { in: productIds },
            },
            select: {
              id: true,
              productId: true,
              variantId: true,
              landedUnitCost: true,
            },
          })
        : Promise.resolve([] as any[]),
    ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));
    // Key on "productId::variantId|''" so product-level overrides
    // (variantId=null) are disambiguated from variant-level ones.
    const franchisePriceByKey = new Map(
      franchisePrices.map((fp: any) => [
        `${fp.productId}::${fp.variantId ?? ''}`,
        fp,
      ]),
    );

    return {
      ...request,
      items: items.map((it) => ({
        ...it,
        product: productById.get(it.productId) ?? null,
        variant: it.variantId ? variantById.get(it.variantId) ?? null : null,
        franchisePrice:
          franchisePriceByKey.get(`${it.productId}::${it.variantId ?? ''}`) ??
          null,
      })),
    };
  }

  async findByFranchiseId(
    franchiseId: string,
    params: { page: number; limit: number; status?: string },
  ): Promise<{ requests: any[]; total: number }> {
    const where: any = { franchiseId };

    if (params.status) {
      where.status = params.status;
    }

    const skip = (params.page - 1) * params.limit;

    const [requests, total] = await this.prisma.$transaction([
      this.prisma.procurementRequest.findMany({
        where,
        include: {
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.procurementRequest.count({ where }),
    ]);

    return { requests, total };
  }

  async findAllPaginated(params: {
    page: number;
    limit: number;
    status?: string;
    franchiseId?: string;
    search?: string;
  }): Promise<{ requests: any[]; total: number }> {
    const where: any = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.franchiseId) {
      where.franchiseId = params.franchiseId;
    }

    if (params.search) {
      where.OR = [
        { requestNumber: { contains: params.search, mode: 'insensitive' } },
        {
          franchise: {
            businessName: { contains: params.search, mode: 'insensitive' },
          },
        },
        {
          franchise: {
            franchiseCode: { contains: params.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const skip = (params.page - 1) * params.limit;

    const [requests, total] = await this.prisma.$transaction([
      this.prisma.procurementRequest.findMany({
        where,
        include: {
          franchise: {
            select: {
              id: true,
              franchiseCode: true,
              businessName: true,
              ownerName: true,
            },
          },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.procurementRequest.count({ where }),
    ]);

    return { requests, total };
  }

  async create(
    data: {
      franchiseId: string;
      requestNumber: string;
      procurementFeeRate: number;
      // Phase 235 — franchise-supplied notes + the staff/user who created it.
      notes?: string | null;
      requestedByStaffId?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const client = tx ?? this.prisma;
    return client.procurementRequest.create({
      data: {
        franchiseId: data.franchiseId,
        requestNumber: data.requestNumber,
        procurementFeeRate: data.procurementFeeRate,
        status: 'DRAFT',
        notes: data.notes ?? null,
        requestedByStaffId: data.requestedByStaffId ?? null,
      },
      include: {
        items: true,
      },
    });
  }

  /**
   * Phase 235 — tx-aware request-number allocation. The `increment: 1` upsert
   * takes a row-level lock on the single ProcurementSequence row, so concurrent
   * create transactions serialize on it (race-safe without the standalone
   * Serializable wrapper that `generateNextRequestNumber` uses). Running it
   * INSIDE the create tx means a failed create rolls the increment back instead
   * of burning the number.
   */
  async nextRequestNumberInTx(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const sequence = await tx.procurementSequence.upsert({
      where: { id: 1 },
      update: { lastNumber: { increment: 1 } },
      create: { id: 1, lastNumber: 1 },
    });
    return `SM-PO-${year}-${String(sequence.lastNumber).padStart(6, '0')}`;
  }

  async update(
    id: string,
    data: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const client = tx ?? this.prisma;
    return client.procurementRequest.update({
      where: { id },
      data,
      include: {
        items: true,
      },
    });
  }

  async createItems(
    procurementRequestId: string,
    items: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      productTitle: string;
      variantTitle?: string;
      requestedQty: number;
      // Phase 237 — MRP snapshot captured at creation.
      mrpSnapshot?: number | null;
    }>,
    tx?: Prisma.TransactionClient,
  ): Promise<any[]> {
    const client = tx ?? this.prisma;
    const createData = items.map((item) => ({
      procurementRequestId,
      productId: item.productId,
      variantId: item.variantId ?? null,
      globalSku: item.globalSku,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle ?? null,
      requestedQty: item.requestedQty,
      mrpSnapshot: item.mrpSnapshot ?? null,
      status: 'PENDING' as const,
    }));

    await client.procurementRequestItem.createMany({
      data: createData,
    });

    return client.procurementRequestItem.findMany({
      where: { procurementRequestId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateItem(
    itemId: string,
    data: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const client = tx ?? this.prisma;
    return client.procurementRequestItem.update({
      where: { id: itemId },
      data,
    });
  }

  async findItemById(itemId: string, tx?: Prisma.TransactionClient): Promise<any | null> {
    const client = tx ?? this.prisma;
    return client.procurementRequestItem.findUnique({
      where: { id: itemId },
    });
  }

  async generateNextRequestNumber(): Promise<string> {
    const year = new Date().getFullYear();

    const sequence = await this.prisma.$transaction(async (tx) => {
      return tx.procurementSequence.upsert({
        where: { id: 1 },
        update: { lastNumber: { increment: 1 } },
        create: { id: 1, lastNumber: 1 },
      });
    }, { isolationLevel: 'Serializable' });

    const paddedNumber = String(sequence.lastNumber).padStart(6, '0');
    return `SM-PO-${year}-${paddedNumber}`;
  }

  async calculateTotals(id: string, tx?: Prisma.TransactionClient): Promise<{
    totalRequestedAmount: Prisma.Decimal;
    totalApprovedAmount: Prisma.Decimal;
    procurementFeeAmount: Prisma.Decimal;
    finalPayableAmount: Prisma.Decimal;
  }> {
    const client = tx ?? this.prisma;
    const zero = new Prisma.Decimal(0);
    const request = await client.procurementRequest.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!request) {
      return {
        totalRequestedAmount: zero,
        totalApprovedAmount: zero,
        procurementFeeAmount: zero,
        finalPayableAmount: zero,
      };
    }

    let totalApprovedAmount = new Prisma.Decimal(0);
    let procurementFeeAmount = new Prisma.Decimal(0);
    let finalPayableAmount = new Prisma.Decimal(0);

    for (const item of request.items) {
      const landedCost = new Prisma.Decimal(item.landedUnitCost ?? 0);
      const feePerUnit = new Prisma.Decimal(item.procurementFeePerUnit ?? 0);
      const finalUnitCost = new Prisma.Decimal(item.finalUnitCostToFranchise ?? 0);

      // Phase 159p (audit #14) — ONE denominator for all three aggregates so
      // finalPayable == totalApproved + procurementFee always holds. Bill the
      // received quantity once any units have been received (pay-on-receipt),
      // otherwise the approved quantity (the pre-receipt estimate). Previously
      // totalApproved used approvedQty while the other two used the
      // received-or-approved qty, so the books drifted after a partial receipt.
      const qty = item.receivedQty > 0 ? item.receivedQty : item.approvedQty;

      totalApprovedAmount = totalApprovedAmount.plus(landedCost.times(qty));
      procurementFeeAmount = procurementFeeAmount.plus(feePerUnit.times(qty));
      finalPayableAmount = finalPayableAmount.plus(finalUnitCost.times(qty));
    }

    return {
      totalRequestedAmount: zero, // Not priced at request time
      totalApprovedAmount,
      procurementFeeAmount,
      finalPayableAmount,
    };
  }
}
