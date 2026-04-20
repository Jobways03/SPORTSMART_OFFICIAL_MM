import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersFacade: OrdersPublicFacade,
  ) {}

  /* ── Processing ───────────────────────────────────────────────────── */

  async findDeliveredSubOrders(): Promise<DeliveredSubOrder[]> {
    // Uses OrdersPublicFacade instead of direct subOrder query (module boundary)
    const subOrders = await this.ordersFacade.findDeliveredSubOrdersPastReturnWindow();

    // Filter to seller-only orders (franchise orders processed separately)
    return subOrders.filter(
      (so: any) => so.fulfillmentNodeType === 'SELLER' && so.sellerId,
    ) as unknown as DeliveredSubOrder[];
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
      // Atomic-claim: only mark this sub-order processed if it isn't already.
      // If another job instance beat us to it, the updateMany returns 0 and
      // we abort the transaction without writing duplicate commission rows.
      // This is the key idempotency guard for the lock-expired-mid-batch
      // race: lock TTL is 30s, this batch may take longer, a second instance
      // can pick up the same sub-order — but only one will win the claim.
      const claim = await tx.subOrder.updateMany({
        where: { id: subOrderId, commissionProcessed: false },
        data: { commissionProcessed: true },
      });
      if (claim.count === 0) {
        // Already processed by another instance — silent no-op.
        return;
      }

      // Use createMany with skipDuplicates so a partially-written batch
      // (e.g. recovered from a crash) doesn't crash the whole transaction.
      // The orderItemId column is @unique so duplicates are ignored cleanly.
      if (records.length > 0) {
        await tx.commissionRecord.createMany({
          data: records as any,
          skipDuplicates: true,
        });
      }
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
