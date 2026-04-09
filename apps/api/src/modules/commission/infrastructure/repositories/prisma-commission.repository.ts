import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  CommissionRepository,
  CommissionRecordFilter,
  CommissionSettingsData,
  CommissionSummary,
  CreateCommissionRecordData,
  DeliveredSubOrder,
  SellerProductMapping,
} from '../../domain/repositories/commission.repository.interface';

@Injectable()
export class PrismaCommissionRepository implements CommissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Processing ───────────────────────────────────────────────────── */

  async findDeliveredSubOrders(): Promise<DeliveredSubOrder[]> {
    return this.prisma.subOrder.findMany({
      where: {
        fulfillmentStatus: 'DELIVERED',
        commissionProcessed: false,
        returnWindowEndsAt: { lte: new Date() },
        paymentStatus: { not: 'CANCELLED' },
        masterOrder: { paymentStatus: 'PAID' },
      },
      include: {
        items: true,
        masterOrder: { select: { orderNumber: true, paymentStatus: true } },
        seller: { select: { id: true, sellerShopName: true } },
      },
    }) as unknown as DeliveredSubOrder[];
  }

  async getSellerProductMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<SellerProductMapping | null> {
    return this.prisma.sellerProductMapping.findFirst({
      where: {
        sellerId,
        productId,
        ...(variantId ? { variantId } : { variantId: null }),
        isActive: true,
        approvalStatus: 'APPROVED',
      },
      select: { settlementPrice: true },
    });
  }

  /**
   * Atomically creates commission records for every item in a sub-order
   * and marks the sub-order as processed — all inside a single transaction.
   */
  async processSubOrderCommission(
    subOrderId: string,
    records: CreateCommissionRecordData[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const record of records) {
        // Skip if commission already exists for this item
        const existing = await tx.commissionRecord.findUnique({
          where: { orderItemId: record.orderItemId },
        });
        if (existing) continue;

        await tx.commissionRecord.create({ data: record as any });
      }

      await tx.subOrder.update({
        where: { id: subOrderId },
        data: { commissionProcessed: true },
      });
    });
  }

  /* ── Commission records (admin) ───────────────────────────────────── */

  async getCommissionRecords(
    filter: CommissionRecordFilter,
    page: number,
    limit: number,
  ): Promise<{ records: any[]; total: number }> {
    const where = this.buildWhere(filter);
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.commissionRecord.count({ where }),
    ]);

    return { records, total };
  }

  /* ── Commission records (seller) ──────────────────────────────────── */

  async getSellerCommissionRecords(
    sellerId: string,
    filter: Omit<CommissionRecordFilter, 'sellerId' | 'commissionType'>,
    page: number,
    limit: number,
  ): Promise<{ records: any[]; total: number }> {
    const where = this.buildWhere({ ...filter, sellerId });
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.commissionRecord.count({ where }),
    ]);

    return { records, total };
  }

  /* ── Admin summary ────────────────────────────────────────────────── */

  async getAdminCommissionSummary(): Promise<CommissionSummary> {
    const [totalRecords, platformAgg, settlementAgg, marginAgg, pendingCount, settledCount] =
      await Promise.all([
        this.prisma.commissionRecord.count(),
        this.prisma.commissionRecord.aggregate({
          _sum: { totalPlatformAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { totalSettlementAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { platformMargin: true },
        }),
        this.prisma.commissionRecord.count({ where: { status: 'PENDING' } }),
        this.prisma.commissionRecord.count({ where: { status: 'SETTLED' } }),
      ]);

    return {
      totalRecords,
      pendingCount,
      settledCount,
      totalPlatformRevenue: Number(platformAgg._sum.totalPlatformAmount || 0),
      totalSellerPayouts: Number(settlementAgg._sum.totalSettlementAmount || 0),
      totalPlatformMargin: Number(marginAgg._sum.platformMargin || 0),
    };
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  async getCommissionSettings(): Promise<any> {
    let settings = await this.prisma.commissionSetting.findUnique({
      where: { id: 'global' },
    });

    if (!settings) {
      settings = await this.prisma.commissionSetting.create({
        data: { id: 'global' },
      });
    }

    return settings;
  }

  async upsertCommissionSettings(data: CommissionSettingsData): Promise<any> {
    return this.prisma.commissionSetting.upsert({
      where: { id: 'global' },
      update: {
        commissionType: data.commissionType as any,
        commissionValue: data.commissionValue,
        secondCommissionValue: data.secondCommissionValue ?? 0,
        fixedCommissionType: data.fixedCommissionType ?? 'Product',
        enableMaxCommission: data.enableMaxCommission ?? false,
        maxCommissionAmount: data.maxCommissionAmount ?? null,
      },
      create: {
        id: 'global',
        commissionType: data.commissionType as any,
        commissionValue: data.commissionValue,
        secondCommissionValue: data.secondCommissionValue ?? 0,
        fixedCommissionType: data.fixedCommissionType ?? 'Product',
        enableMaxCommission: data.enableMaxCommission ?? false,
        maxCommissionAmount: data.maxCommissionAmount ?? null,
      },
    });
  }

  /* ── Existence check ──────────────────────────────────────────────── */

  async commissionExistsForItem(orderItemId: string): Promise<boolean> {
    const record = await this.prisma.commissionRecord.findUnique({
      where: { orderItemId },
    });
    return !!record;
  }

  /* ── Private helpers ──────────────────────────────────────────────── */

  private buildWhere(filter: CommissionRecordFilter & { sellerId?: string }): any {
    const where: any = {};

    if (filter.sellerId) {
      where.sellerId = filter.sellerId;
    }

    if (filter.commissionType) {
      where.commissionType = filter.commissionType;
    }

    if (filter.status && ['PENDING', 'SETTLED', 'REFUNDED'].includes(filter.status)) {
      where.status = filter.status;
    }

    if (filter.dateFrom || filter.dateTo) {
      where.createdAt = {};
      if (filter.dateFrom) where.createdAt.gte = new Date(filter.dateFrom);
      if (filter.dateTo) {
        const to = new Date(filter.dateTo);
        to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    if (filter.search) {
      where.OR = [
        { orderNumber: { contains: filter.search, mode: 'insensitive' } },
        { productTitle: { contains: filter.search, mode: 'insensitive' } },
        { sellerName: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
