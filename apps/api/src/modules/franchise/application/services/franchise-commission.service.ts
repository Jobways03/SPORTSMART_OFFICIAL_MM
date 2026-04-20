import { Injectable, Inject } from '@nestjs/common';
import {
  FranchiseFinanceRepository,
  FRANCHISE_FINANCE_REPOSITORY,
} from '../../domain/repositories/franchise-finance.repository.interface';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class FranchiseCommissionService {
  constructor(
    @Inject(FRANCHISE_FINANCE_REPOSITORY)
    private readonly financeRepo: FranchiseFinanceRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('FranchiseCommissionService');
  }

  // ── Record online-order commission ──────────────────────────

  async recordOnlineOrderCommission(params: {
    franchiseId: string;
    subOrderId: string;
    orderNumber: string;
    items: Array<{ unitPrice: number; quantity: number }>;
    commissionRate: number;
  }) {
    const baseAmount = params.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const computedAmount =
      Math.round(baseAmount * (params.commissionRate / 100) * 100) / 100;
    const platformEarning = computedAmount;
    const franchiseEarning =
      Math.round((baseAmount - computedAmount) * 100) / 100;

    const entry = await this.financeRepo.createLedgerEntry({
      franchiseId: params.franchiseId,
      sourceType: 'ONLINE_ORDER',
      sourceId: params.subOrderId,
      description: `Online order commission for ${params.orderNumber}`,
      baseAmount,
      rate: params.commissionRate,
      computedAmount,
      platformEarning,
      franchiseEarning,
    });

    await this.eventBus.publish({
      eventName: 'franchise.finance.commission_recorded',
      aggregate: 'FranchiseFinanceLedger',
      aggregateId: entry.id,
      occurredAt: new Date(),
      payload: {
        entryId: entry.id,
        franchiseId: params.franchiseId,
        sourceType: 'ONLINE_ORDER',
        sourceId: params.subOrderId,
        baseAmount,
        computedAmount,
        platformEarning,
        franchiseEarning,
      },
    });

    this.logger.log(
      `Online order commission recorded — franchise=${params.franchiseId}, order=${params.orderNumber}, base=${baseAmount}, commission=${computedAmount}`,
    );

    return entry;
  }

  // ── Record POS sale commission ──────────────────────────────
  //
  // POS sales generate commission in the same way online orders do. We use
  // the franchise's `onlineFulfillmentRate` as the POS commission rate —
  // a single rate simplifies contracts; introduce a `posCommissionRate`
  // column if the business ever needs a split.

  async recordPosCommission(params: {
    franchiseId: string;
    saleId: string;
    saleNumber: string;
    netAmount: number;
    commissionRate: number;
  }) {
    const baseAmount = Math.round(params.netAmount * 100) / 100;
    const computedAmount =
      Math.round(baseAmount * (params.commissionRate / 100) * 100) / 100;
    const platformEarning = computedAmount;
    const franchiseEarning =
      Math.round((baseAmount - computedAmount) * 100) / 100;

    const entry = await this.financeRepo.createLedgerEntry({
      franchiseId: params.franchiseId,
      sourceType: 'POS_SALE',
      sourceId: params.saleId,
      description: `POS sale commission for ${params.saleNumber}`,
      baseAmount,
      rate: params.commissionRate,
      computedAmount,
      platformEarning,
      franchiseEarning,
    });

    await this.eventBus.publish({
      eventName: 'franchise.finance.pos_commission_recorded',
      aggregate: 'FranchiseFinanceLedger',
      aggregateId: entry.id,
      occurredAt: new Date(),
      payload: {
        entryId: entry.id,
        franchiseId: params.franchiseId,
        sourceType: 'POS_SALE',
        sourceId: params.saleId,
        baseAmount,
        computedAmount,
        platformEarning,
        franchiseEarning,
      },
    });

    this.logger.log(
      `POS sale commission recorded — franchise=${params.franchiseId}, sale=${params.saleNumber}, base=${baseAmount}, commission=${computedAmount}`,
    );

    return entry;
  }

  // ── Void a POS sale's commission ────────────────────────────
  //
  // A void means the sale never effectively happened (e.g. wrong scan).
  // We mark the original ledger entry REVERSED so it is excluded from the
  // settlement aggregation, without creating a paired negative entry.

  async recordPosVoid(params: { franchiseId: string; saleId: string }) {
    const original = await this.financeRepo.findLedgerEntryBySource(
      'POS_SALE',
      params.saleId,
    );

    if (!original) {
      this.logger.warn(
        `No POS_SALE ledger entry found for saleId=${params.saleId} to void`,
      );
      return null;
    }

    if (original.status === 'ACCRUED' || original.status === 'SETTLED') {
      this.logger.warn(
        `Cannot void POS commission for sale ${params.saleId}: already ${original.status}`,
      );
      return null;
    }

    const updated = await this.financeRepo.updateLedgerEntryStatus(
      original.id,
      'REVERSED',
    );

    await this.eventBus.publish({
      eventName: 'franchise.finance.pos_void_recorded',
      aggregate: 'FranchiseFinanceLedger',
      aggregateId: original.id,
      occurredAt: new Date(),
      payload: {
        entryId: original.id,
        franchiseId: params.franchiseId,
        saleId: params.saleId,
      },
    });

    this.logger.log(
      `POS commission voided for sale ${params.saleId} — franchise=${params.franchiseId}`,
    );

    return updated;
  }

  // ── Record POS sale return (partial or full) ────────────────
  //
  // Unlike void, a return creates a paired POS_SALE_REVERSAL entry for the
  // refunded portion. Original POS_SALE stays PENDING so that net POS
  // totals for the cycle = POS_SALE sum − POS_SALE_REVERSAL sum.

  async recordPosReturn(params: {
    franchiseId: string;
    saleId: string;
    saleNumber: string;
    refundAmount: number;
    commissionRate: number;
  }) {
    const baseAmount = Math.round(params.refundAmount * 100) / 100;
    const computedAmount =
      Math.round(baseAmount * (params.commissionRate / 100) * 100) / 100;
    // Reversal entries flip both amounts so aggregation subtracts correctly
    const platformEarning = -computedAmount;
    const franchiseEarning =
      -(Math.round((baseAmount - computedAmount) * 100) / 100);

    const entry = await this.financeRepo.createLedgerEntry({
      franchiseId: params.franchiseId,
      sourceType: 'POS_SALE_REVERSAL',
      sourceId: params.saleId,
      description: `POS return reversal for ${params.saleNumber}`,
      baseAmount: -baseAmount,
      rate: params.commissionRate,
      computedAmount: -computedAmount,
      platformEarning,
      franchiseEarning,
    });

    await this.eventBus.publish({
      eventName: 'franchise.finance.pos_return_recorded',
      aggregate: 'FranchiseFinanceLedger',
      aggregateId: entry.id,
      occurredAt: new Date(),
      payload: {
        entryId: entry.id,
        franchiseId: params.franchiseId,
        saleId: params.saleId,
        refundAmount: baseAmount,
        reversalAmount: computedAmount,
      },
    });

    this.logger.log(
      `POS return reversal recorded — franchise=${params.franchiseId}, sale=${params.saleNumber}, refund=${baseAmount}, reversal=${computedAmount}`,
    );

    return entry;
  }

  // ── Record procurement fee ──────────────────────────────────

  async recordProcurementFee(params: {
    franchiseId: string;
    procurementRequestId: string;
    totalLandedCost: number;
    feeRate: number;
  }) {
    const baseAmount = params.totalLandedCost;
    const computedAmount =
      Math.round(baseAmount * (params.feeRate / 100) * 100) / 100;
    const platformEarning = computedAmount;
    const franchiseEarning = 0;

    const entry = await this.financeRepo.createLedgerEntry({
      franchiseId: params.franchiseId,
      sourceType: 'PROCUREMENT_FEE',
      sourceId: params.procurementRequestId,
      description: `Procurement fee for request ${params.procurementRequestId}`,
      baseAmount,
      rate: params.feeRate,
      computedAmount,
      platformEarning,
      franchiseEarning,
    });

    await this.eventBus.publish({
      eventName: 'franchise.finance.procurement_fee_recorded',
      aggregate: 'FranchiseFinanceLedger',
      aggregateId: entry.id,
      occurredAt: new Date(),
      payload: {
        entryId: entry.id,
        franchiseId: params.franchiseId,
        sourceType: 'PROCUREMENT_FEE',
        sourceId: params.procurementRequestId,
        baseAmount,
        computedAmount,
        platformEarning,
      },
    });

    this.logger.log(
      `Procurement fee recorded — franchise=${params.franchiseId}, request=${params.procurementRequestId}, cost=${baseAmount}, fee=${computedAmount}`,
    );

    return entry;
  }


  // ── Record return reversal ──────────────────────────────────

  async recordReturnReversal(params: {
    franchiseId: string;
    originalLedgerEntryId: string;
    subOrderId: string;
    reversalAmount: number;
  }) {
    // Create a reversal entry with negative amounts
    const entry = await this.financeRepo.createLedgerEntry({
      franchiseId: params.franchiseId,
      sourceType: 'RETURN_REVERSAL',
      sourceId: params.subOrderId,
      description: `Return reversal for order ${params.subOrderId} (original entry: ${params.originalLedgerEntryId})`,
      baseAmount: -params.reversalAmount,
      rate: 0,
      computedAmount: 0,
      platformEarning: 0,
      franchiseEarning: -params.reversalAmount,
    });

    // Mark the original entry as REVERSED (if provided)
    if (params.originalLedgerEntryId) {
      await this.financeRepo.updateLedgerEntryStatus(
        params.originalLedgerEntryId,
        'REVERSED',
      );
    }

    await this.eventBus.publish({
      eventName: 'franchise.finance.reversal_recorded',
      aggregate: 'FranchiseFinanceLedger',
      aggregateId: entry.id,
      occurredAt: new Date(),
      payload: {
        entryId: entry.id,
        franchiseId: params.franchiseId,
        sourceType: 'RETURN_REVERSAL',
        originalEntryId: params.originalLedgerEntryId,
        subOrderId: params.subOrderId,
        reversalAmount: params.reversalAmount,
      },
    });

    this.logger.log(
      `Return reversal recorded — franchise=${params.franchiseId}, order=${params.subOrderId}, amount=${params.reversalAmount}`,
    );

    return entry;
  }

  // ── Create manual adjustment ────────────────────────────────

  async createManualAdjustment(params: {
    franchiseId: string;
    amount: number; // positive = credit to franchise, negative = debit
    reason: string;
    adminId: string;
  }): Promise<any> {
    const isCredit = params.amount >= 0;

    const entry = await this.financeRepo.createLedgerEntry({
      franchiseId: params.franchiseId,
      sourceType: 'ADJUSTMENT',
      sourceId: `ADJ-${params.adminId}-${Date.now()}`,
      description: params.reason,
      baseAmount: Math.abs(params.amount),
      rate: 0,
      computedAmount: Math.abs(params.amount),
      platformEarning: isCredit ? 0 : Math.abs(params.amount),
      franchiseEarning: isCredit
        ? Math.abs(params.amount)
        : -Math.abs(params.amount),
    });

    await this.eventBus
      .publish({
        eventName: 'franchise.finance.adjustment_created',
        aggregate: 'FranchiseFinanceLedger',
        aggregateId: entry.id,
        occurredAt: new Date(),
        payload: {
          entryId: entry.id,
          franchiseId: params.franchiseId,
          amount: params.amount,
          reason: params.reason,
          adminId: params.adminId,
        },
      })
      .catch(() => {});

    this.logger.log(
      `Manual adjustment recorded — franchise=${params.franchiseId}, amount=${params.amount}, admin=${params.adminId}`,
    );

    return entry;
  }

  // ── Create penalty ─────────────────────────────────────────

  async createPenalty(params: {
    franchiseId: string;
    amount: number; // always positive (deducted from franchise)
    reason: string;
    adminId: string;
  }): Promise<any> {
    const entry = await this.financeRepo.createLedgerEntry({
      franchiseId: params.franchiseId,
      sourceType: 'PENALTY',
      sourceId: `PEN-${params.adminId}-${Date.now()}`,
      description: params.reason,
      baseAmount: params.amount,
      rate: 0,
      computedAmount: params.amount,
      platformEarning: params.amount,
      franchiseEarning: -params.amount,
    });

    await this.eventBus
      .publish({
        eventName: 'franchise.finance.penalty_created',
        aggregate: 'FranchiseFinanceLedger',
        aggregateId: entry.id,
        occurredAt: new Date(),
        payload: {
          entryId: entry.id,
          franchiseId: params.franchiseId,
          amount: params.amount,
          reason: params.reason,
          adminId: params.adminId,
        },
      })
      .catch(() => {});

    this.logger.log(
      `Penalty recorded — franchise=${params.franchiseId}, amount=${params.amount}, admin=${params.adminId}`,
    );

    return entry;
  }

  // ── Get earnings summary (dashboard) ────────────────────────

  async getEarningsSummary(franchiseId: string) {
    return this.financeRepo.getEarningsSummary(franchiseId);
  }

  // ── Commission records (ONLINE_ORDER ledger entries with order hydration) ──
  //
  // Parallel to the seller's `/seller/earnings/records` endpoint. Surfaces
  // the same ledger entries as `getLedgerHistory({ sourceType: 'ONLINE_ORDER' })`
  // but enriches each row with its SubOrder + OrderItem data so the UI can
  // render order number, product name, quantity, etc. — not just the
  // abstract base-amount/rate/computed numbers.

  async getCommissionRecords(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      status?: string;
      fromDate?: Date;
      toDate?: Date;
      search?: string;
    },
  ) {
    const where: Record<string, unknown> = {
      franchiseId,
      sourceType: 'ONLINE_ORDER',
    };
    if (params.status) where.status = params.status;
    if (params.fromDate || params.toDate) {
      const createdAt: Record<string, Date> = {};
      if (params.fromDate) createdAt.gte = params.fromDate;
      if (params.toDate) createdAt.lte = params.toDate;
      where.createdAt = createdAt;
    }

    // If the user searched by order number, resolve the matching sub-orders
    // first so we can constrain the ledger query at the DB level (accurate
    // pagination total).
    if (params.search && params.search.trim()) {
      const searchTerm = params.search.trim();
      const matchingSubOrders = await this.prisma.subOrder.findMany({
        where: {
          franchiseId,
          masterOrder: {
            orderNumber: { contains: searchTerm, mode: 'insensitive' },
          },
        },
        select: { id: true },
      });
      where.sourceId = { in: matchingSubOrders.map((so) => so.id) };
    }

    const total = await this.prisma.franchiseFinanceLedger.count({ where: where as any });
    const entries = await this.prisma.franchiseFinanceLedger.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    });

    // Hydrate each entry with its SubOrder + items in a single round-trip.
    const subOrderIds = entries.map((e) => e.sourceId).filter(Boolean) as string[];
    const subOrders = subOrderIds.length
      ? await this.prisma.subOrder.findMany({
          where: { id: { in: subOrderIds } },
          include: {
            masterOrder: { select: { orderNumber: true, orderStatus: true } },
            items: {
              select: {
                productTitle: true,
                variantTitle: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
              },
            },
          },
        })
      : [];
    const subOrderMap = new Map(subOrders.map((so) => [so.id, so]));

    const records = entries.map((entry) => {
      const so = subOrderMap.get(entry.sourceId);
      const items = so?.items ?? [];
      const firstItem = items[0];
      const totalQuantity = items.reduce((acc, i) => acc + i.quantity, 0);
      return {
        id: entry.id,
        subOrderId: entry.sourceId,
        orderNumber: so?.masterOrder?.orderNumber ?? '\u2014',
        orderStatus: so?.masterOrder?.orderStatus ?? null,
        productTitle: firstItem?.productTitle ?? '\u2014',
        variantTitle: firstItem?.variantTitle ?? null,
        itemCount: items.length,
        totalQuantity,
        baseAmount: Number(entry.baseAmount),
        rate: Number(entry.rate),
        computedAmount: Number(entry.computedAmount),
        platformEarning: Number(entry.platformEarning),
        franchiseEarning: Number(entry.franchiseEarning),
        status: entry.status,
        createdAt: entry.createdAt,
      };
    });

    return {
      records,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit) || 1,
      },
    };
  }

  // ── Get ledger history (paginated) ──────────────────────────

  async getLedgerHistory(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      sourceType?: string;
      status?: string;
      fromDate?: Date;
      toDate?: Date;
    },
  ) {
    return this.financeRepo.findLedgerEntries(franchiseId, params);
  }
}
