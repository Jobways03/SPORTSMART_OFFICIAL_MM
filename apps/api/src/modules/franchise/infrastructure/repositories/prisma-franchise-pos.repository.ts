import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FranchisePosRepository } from '../../domain/repositories/franchise-pos.repository.interface';
import { PosSaleStatus, PosSaleType, PosPaymentMethod, Prisma } from '@prisma/client';

@Injectable()
export class PrismaFranchisePosRepository implements FranchisePosRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<any | null> {
    return this.prisma.franchisePosSale.findUnique({
      where: { id },
    });
  }

  async findByIdWithItems(id: string): Promise<any | null> {
    return this.prisma.franchisePosSale.findUnique({
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
  }

  async findByFranchiseId(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      status?: string;
      saleType?: string;
      fromDate?: Date;
      toDate?: Date;
      search?: string;
    },
  ): Promise<{ sales: any[]; total: number }> {
    const where: any = { franchiseId };

    if (params.status) {
      where.status = params.status as PosSaleStatus;
    }

    if (params.saleType) {
      where.saleType = params.saleType;
    }

    if (params.fromDate || params.toDate) {
      where.soldAt = {};
      if (params.fromDate) {
        where.soldAt.gte = params.fromDate;
      }
      if (params.toDate) {
        where.soldAt.lte = params.toDate;
      }
    }

    if (params.search) {
      where.OR = [
        { saleNumber: { contains: params.search, mode: 'insensitive' } },
        { customerName: { contains: params.search, mode: 'insensitive' } },
        { customerPhone: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const skip = (params.page - 1) * params.limit;

    const [sales, total] = await this.prisma.$transaction([
      this.prisma.franchisePosSale.findMany({
        where,
        include: {
          _count: { select: { items: true } },
        },
        orderBy: { soldAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchisePosSale.count({ where }),
    ]);

    return { sales, total };
  }

  async createSale(data: {
    saleNumber: string;
    franchiseId: string;
    saleType: string;
    customerName?: string;
    customerPhone?: string;
    grossAmount: number;
    discountAmount: number;
    taxAmount: number;
    cgstAmount?: number;
    sgstAmount?: number;
    igstAmount?: number;
    placeOfSupplyState?: string | null;
    netAmount: number;
    paymentMethod: string;
    createdByStaffId?: string | null;
    commissionRate?: number | null;
    items: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      productTitle: string;
      variantTitle?: string;
      quantity: number;
      unitPrice: number;
      lineDiscount: number;
      lineTotal: number;
      hsnCode?: string | null;
      gstRateBps?: number;
      taxableAmount?: number;
      cgstAmount?: number;
      sgstAmount?: number;
      igstAmount?: number;
    }>;
  }, tx?: Prisma.TransactionClient): Promise<any> {
    const { items, saleType, paymentMethod, ...saleData } = data;
    const client = tx ?? this.prisma;

    return client.franchisePosSale.create({
      data: {
        ...saleData,
        // DTO-validated values; cast the strings to the column enums.
        saleType: saleType as PosSaleType,
        paymentMethod: paymentMethod as PosPaymentMethod,
        status: 'COMPLETED',
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId ?? null,
            globalSku: item.globalSku,
            franchiseSku: item.franchiseSku ?? null,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineDiscount: item.lineDiscount,
            lineTotal: item.lineTotal,
            // Phase 26 GST (POS) — per-item tax snapshot.
            hsnCode: item.hsnCode ?? null,
            gstRateBps: item.gstRateBps ?? 0,
            taxableAmount: item.taxableAmount ?? 0,
            cgstAmount: item.cgstAmount ?? 0,
            sgstAmount: item.sgstAmount ?? 0,
            igstAmount: item.igstAmount ?? 0,
          })),
        },
      },
      include: {
        items: true,
      },
    });
  }

  async updateSale(id: string, data: Record<string, unknown>): Promise<any> {
    return this.prisma.franchisePosSale.update({
      where: { id },
      data,
      include: {
        items: true,
      },
    });
  }

  /**
   * CAS-style claim: only flip the row if `status` is still `fromStatus`.
   * `updateMany` returns the affected count; the caller short-circuits
   * to 0 to skip side effects. Used by voidSale to prevent two
   * concurrent retries from both reversing the inventory.
   */
  async claimSaleTransition(
    id: string,
    fromStatus: string,
    patch: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.franchisePosSale.updateMany({
      where: { id, status: fromStatus as any },
      data: patch,
    });
    return result.count;
  }

  async generateNextSaleNumber(franchiseCode: string): Promise<string> {
    const sequence = await this.prisma.$transaction(async (tx) => {
      return tx.posSaleSequence.upsert({
        where: { id: 1 },
        update: { lastNumber: { increment: 1 } },
        create: { id: 1, lastNumber: 1 },
      });
    }, { isolationLevel: 'Serializable' });

    const paddedNumber = String(sequence.lastNumber).padStart(6, '0');
    return `POS-${franchiseCode}-${paddedNumber}`;
  }

  async getDailyReport(
    franchiseId: string,
    range: { gte: Date; lte: Date },
  ): Promise<{
    totalSales: number;
    totalGrossAmount: number;
    totalDiscountAmount: number;
    totalNetAmount: number;
    salesByPaymentMethod: Record<string, { count: number; amount: number }>;
    salesByType: Record<string, { count: number; amount: number }>;
    refundTotal: number;
    voidedSales: { count: number; amount: number };
    returnedSales: { count: number };
    tax: { cgst: number; sgst: number; igst: number; total: number };
  }> {
    // Phase 159s — `range` is the pre-computed UTC window for the franchise's
    // business day (built from the report TZ in the service; audit #4). All
    // aggregation is DB-side via groupBy/aggregate (audit #9) on Decimal columns
    // (audit #14), so no findMany+JS-loop over every row.
    const inRange = { franchiseId, soldAt: { gte: range.gte, lte: range.lte } };
    const nonVoided = { ...inRange, status: { not: PosSaleStatus.VOIDED } };

    const [byStatus, totals, byMethod, byType] = await Promise.all([
      // counts/amounts by status → void + return counts (audit #2)
      this.prisma.franchisePosSale.groupBy({
        by: ['status'],
        where: inRange,
        _count: { _all: true },
        _sum: { netAmount: true },
      }),
      // non-voided overall totals incl. refunds + GST
      this.prisma.franchisePosSale.aggregate({
        where: nonVoided,
        _count: { _all: true },
        _sum: {
          grossAmount: true,
          discountAmount: true,
          netAmount: true,
          refundedAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
        },
      }),
      this.prisma.franchisePosSale.groupBy({
        by: ['paymentMethod'],
        where: nonVoided,
        _count: { _all: true },
        _sum: { netAmount: true, refundedAmount: true },
      }),
      this.prisma.franchisePosSale.groupBy({
        by: ['saleType'],
        where: nonVoided,
        _count: { _all: true },
        _sum: { netAmount: true, refundedAmount: true },
      }),
    ]);

    const num = (d: unknown) => (d == null ? 0 : Number(d));
    const round2 = (n: number) => Math.round(n * 100) / 100;
    // Revenue net of refunds: a returned sale keeps its netAmount on the row but
    // carries refundedAmount, so effective revenue = net − refunded (audit #1/#5).
    const effAmt = (s: any) => round2(num(s._sum.netAmount) - num(s._sum.refundedAmount));

    let voidedCount = 0;
    let voidedAmount = 0;
    let returnedCount = 0;
    for (const s of byStatus) {
      if (s.status === PosSaleStatus.VOIDED) {
        voidedCount = s._count._all;
        voidedAmount = num(s._sum.netAmount);
      } else if (
        s.status === PosSaleStatus.RETURNED ||
        s.status === PosSaleStatus.PARTIALLY_RETURNED
      ) {
        returnedCount += s._count._all;
      }
    }

    const salesByPaymentMethod: Record<string, { count: number; amount: number }> = {};
    for (const m of byMethod) {
      salesByPaymentMethod[m.paymentMethod] = { count: m._count._all, amount: effAmt(m) };
    }
    const salesByType: Record<string, { count: number; amount: number }> = {};
    for (const t of byType) {
      salesByType[t.saleType] = { count: t._count._all, amount: effAmt(t) };
    }

    const cgst = num(totals._sum.cgstAmount);
    const sgst = num(totals._sum.sgstAmount);
    const igst = num(totals._sum.igstAmount);

    return {
      totalSales: totals._count._all,
      totalGrossAmount: round2(num(totals._sum.grossAmount)),
      totalDiscountAmount: round2(num(totals._sum.discountAmount)),
      // audit #1 — refund-adjusted net revenue.
      totalNetAmount: round2(num(totals._sum.netAmount) - num(totals._sum.refundedAmount)),
      salesByPaymentMethod,
      salesByType,
      refundTotal: round2(num(totals._sum.refundedAmount)),
      voidedSales: { count: voidedCount, amount: round2(voidedAmount) },
      returnedSales: { count: returnedCount },
      tax: { cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), total: round2(cgst + sgst + igst) },
    };
  }
}
