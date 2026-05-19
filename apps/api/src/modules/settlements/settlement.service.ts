import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../audit/application/facades/audit-public.facade';
import { MoneyDualWriteHelper } from '../../core/money/money-dual-write.helper';
import { toPaise } from '../../core/money/money-field-registry';
import { SettlementTcsHookService } from '../tax/application/services/settlement-tcs-hook.service';
import { SettlementTds194OHookService } from '../tax/application/services/settlement-tds-194o-hook.service';
import { computeCommissionGst } from '../tax/domain/commission-gst-calculator';

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    // Phase 7 (PR 7.5) — paise-sibling dual-write for cycle / seller
    // settlement / commission record / adjustment writes.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
    // Phase 17 GST — TCS deduction at approval + collection at mark-paid.
    private readonly tcsHook: SettlementTcsHookService,
    // Phase 27 — Section 194-O Income-Tax TDS deduction at approval +
    // withholding at mark-paid. Independent of TCS — both stamp
    // their own ledger row and denorm columns on SellerSettlement.
    private readonly tdsHook: SettlementTds194OHookService,
  ) {}

  /* ── T3: Create settlement cycle ── */
  async createCycle(periodStart: Date, periodEnd: Date) {
    // Find all PENDING commission records within the date range that
    // aren't already attached to a settlement. The `settlementId: null`
    // guard keeps this idempotent across concurrent / overlapping
    // createCycle calls — a record can only be grouped into one cycle.
    // Without it, two cycles with overlapping date ranges both pick
    // up the same PENDING record and the second updateMany (see below)
    // overwrites the first cycle's settlementId, silently detaching
    // records from the earlier cycle's aggregate totals.
    const pendingRecords = await this.prisma.commissionRecord.findMany({
      where: {
        status: 'PENDING',
        settlementId: null,
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      include: {
        seller: {
          select: {
            id: true,
            sellerShopName: true,
            // Phase 28 — needed for commission-GST place-of-supply.
            gstStateCode: true,
          },
        },
      },
    });

    if (pendingRecords.length === 0) {
      return {
        cycle: null,
        message: 'No pending commission records found in this date range',
      };
    }

    // Group by seller
    const sellerMap = new Map<
      string,
      {
        sellerName: string;
        // Phase 28 — captured for commission-GST place-of-supply.
        // May be empty for legacy sellers without a registered GSTIN;
        // the calculator falls back to IGST in that case.
        sellerStateCode: string;
        records: typeof pendingRecords;
        totalPlatformAmount: number;
        totalSettlementAmount: number;
        totalPlatformMargin: number;
        totalItems: number;
        orderIds: Set<string>;
      }
    >();

    for (const rec of pendingRecords) {
      const existing = sellerMap.get(rec.sellerId);
      if (existing) {
        existing.records.push(rec);
        existing.totalPlatformAmount += Number(rec.totalPlatformAmount);
        existing.totalSettlementAmount += Number(rec.totalSettlementAmount);
        existing.totalPlatformMargin += Number(rec.platformMargin);
        existing.totalItems += rec.quantity;
        existing.orderIds.add(rec.subOrderId);
      } else {
        sellerMap.set(rec.sellerId, {
          sellerName: rec.seller?.sellerShopName || rec.sellerName,
          sellerStateCode: rec.seller?.gstStateCode ?? '',
          records: [rec],
          totalPlatformAmount: Number(rec.totalPlatformAmount),
          totalSettlementAmount: Number(rec.totalSettlementAmount),
          totalPlatformMargin: Number(rec.platformMargin),
          totalItems: rec.quantity,
          orderIds: new Set([rec.subOrderId]),
        });
      }
    }

    // Phase 28 — Look up the marketplace's own GST state code once
    // so every seller settlement uses the same place-of-supply origin.
    // Empty when no PlatformGstProfile is seeded — calculator falls
    // back to IGST conservatively in that case.
    const platformProfile = await this.prisma.platformGstProfile.findFirst({
      where: { isDefault: true, isActive: true },
      select: { gstStateCode: true },
    });
    const marketplaceStateCode = platformProfile?.gstStateCode ?? '';

    // Create cycle in a transaction
    const cycle = await this.prisma.$transaction(async (tx) => {
      let cycleTotalAmount = 0;
      let cycleTotalMargin = 0;

      for (const [, data] of sellerMap) {
        cycleTotalAmount += data.totalSettlementAmount;
        cycleTotalMargin += data.totalPlatformMargin;
      }

      const newCycle = await tx.settlementCycle.create({
        data: this.moneyDualWrite.applyPaise('settlementCycle', {
          periodStart,
          periodEnd,
          status: 'DRAFT',
          // .toFixed(2) gives a Decimal-string so the helper's toPaise
          // can convert exactly; the previous `Math.round(x*100)/100`
          // expression yields a fractional JS Number that toPaise
          // rejects (PR 0.4 contract).
          totalAmount: cycleTotalAmount.toFixed(2),
          totalMargin: cycleTotalMargin.toFixed(2),
        }),
      });

      // Create per-seller settlements
      for (const [sellerId, data] of sellerMap) {
        // Phase 28 — compute the commission-GST split at row-creation
        // time so the settlement is fully GST-aware from the first
        // moment it exists. Frozen with the marketplace + seller state
        // codes so a later PlatformGstProfile / Seller.gstStateCode
        // change doesn't rewrite the historical split.
        const commissionGst = computeCommissionGst({
          commissionAmountInPaise: BigInt(
            Math.round(data.totalPlatformMargin * 100),
          ),
          marketplaceStateCode,
          sellerStateCode: data.sellerStateCode,
        });

        const sellerSettlement = await tx.sellerSettlement.create({
          data: this.moneyDualWrite.applyPaise('sellerSettlement', {
            cycleId: newCycle.id,
            sellerId,
            sellerName: data.sellerName,
            totalOrders: data.orderIds.size,
            totalItems: data.totalItems,
            // Same Decimal-string conversion as the cycle totals above.
            totalPlatformAmount: data.totalPlatformAmount.toFixed(2),
            totalSettlementAmount: data.totalSettlementAmount.toFixed(2),
            totalPlatformMargin: data.totalPlatformMargin.toFixed(2),
            status: 'PENDING',
            // Phase 28 — commission-GST denorm columns. Rate stored
            // even when total is 0 so the historical rate snapshot is
            // useful for audits.
            commissionGstRateBps: commissionGst.rateBps,
            commissionGstSplitType: commissionGst.splitType,
            cgstOnCommissionInPaise: commissionGst.cgstInPaise,
            sgstOnCommissionInPaise: commissionGst.sgstInPaise,
            igstOnCommissionInPaise: commissionGst.igstInPaise,
            totalCommissionGstInPaise: commissionGst.totalGstInPaise,
            commissionGstMarketplaceStateCode:
              marketplaceStateCode || null,
            commissionGstSellerStateCode:
              data.sellerStateCode || null,
          }),
        });

        // Link commission records to the settlement. Filter on
        // `settlementId: null` so a concurrent createCycle racing the
        // same record loses the claim — only one cycle wins.
        const recordIds = data.records.map((r) => r.id);
        await tx.commissionRecord.updateMany({
          where: { id: { in: recordIds }, settlementId: null },
          data: this.moneyDualWrite.applyPaise('commissionRecord', {
            settlementId: sellerSettlement.id,
          }),
        });
      }

      return newCycle;
    });

    return { cycle, message: 'Settlement cycle created successfully' };
  }

  /* ── T3: List cycles ── */
  async listCycles(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [cycles, total] = await Promise.all([
      this.prisma.settlementCycle.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { sellerSettlements: true } },
        },
      }),
      this.prisma.settlementCycle.count(),
    ]);

    return {
      cycles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ── T3: Get cycle detail ── */
  async getCycleDetail(cycleId: string) {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
      include: {
        sellerSettlements: {
          orderBy: { totalSettlementAmount: 'desc' },
          include: {
            _count: { select: { commissionRecords: true } },
          },
        },
      },
    });

    if (!cycle) {
      return null;
    }

    // Phase B (P0.5) — attach seller-funded discount deductions per
    // seller. Pulls from `discount_liability_ledger` filtered to
    // liability_party=SELLER and rolled up by seller. The UI uses
    // this to show a "Discount Deductions" line in the per-seller
    // breakdown.
    const sellerIds = (cycle.sellerSettlements ?? []).map((s: any) => s.sellerId);
    let discountDeductionsBySeller: Record<string, {
      totalAmountInPaise: string;
      entries: Array<{
        masterOrderId: string;
        subOrderId: string | null;
        orderItemId: string | null;
        discountId: string;
        discountCode: string | null;
        fundingType: string;
        amountInPaise: string;
        status: string;
        reason: string | null;
        createdAt: Date;
      }>;
    }> = {};
    if (sellerIds.length > 0) {
      const rows = await this.prisma.discountLiabilityLedger.findMany({
        where: {
          sellerId: { in: sellerIds },
          liabilityParty: 'SELLER',
          status: { in: ['APPLIED', 'SETTLED'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      for (const row of rows) {
        if (!row.sellerId) continue;
        const bucket = (discountDeductionsBySeller[row.sellerId] ??= {
          totalAmountInPaise: '0',
          entries: [],
        });
        bucket.totalAmountInPaise = (
          BigInt(bucket.totalAmountInPaise) + BigInt(row.amountInPaise)
        ).toString();
        bucket.entries.push({
          masterOrderId: row.masterOrderId,
          subOrderId: row.subOrderId,
          orderItemId: row.orderItemId,
          discountId: row.discountId,
          discountCode: row.discountCode,
          fundingType: row.fundingType,
          amountInPaise: row.amountInPaise.toString(),
          status: row.status,
          reason: row.reason,
          createdAt: row.createdAt,
        });
      }
    }

    return { ...cycle, discountDeductionsBySeller };
  }

  /* ── T3: Approve cycle ── */
  async approveCycle(cycleId: string, actorId?: string) {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
    });

    if (!cycle) {
      return { success: false, message: 'Settlement cycle not found' };
    }

    if (cycle.status !== 'DRAFT' && cycle.status !== 'PREVIEWED') {
      return {
        success: false,
        message: `Cannot approve a cycle with status: ${cycle.status}`,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.settlementCycle.update({
        where: { id: cycleId },
        data: { status: 'APPROVED' },
      });

      await tx.sellerSettlement.updateMany({
        where: { cycleId },
        data: { status: 'APPROVED' },
      });
    });

    // Phase 17 GST — apply TCS to every SellerSettlement in the cycle.
    // Runs after the APPROVED flip so the TCS hook sees the settlements
    // in their final approved shape. Errors per-settlement are logged
    // by the hook and don't roll back the cycle approval — finance
    // can re-run targeted compute via the admin endpoint.
    let tcsResult;
    try {
      tcsResult = await this.tcsHook.applyToCycleOnApprove({
        cycleId,
        actorId,
      });
    } catch (err) {
      this.logger.warn(
        `TCS apply-on-approve failed for cycle ${cycleId}: ${(err as Error).message}`,
      );
    }

    // Phase 27 — apply Section 194-O TDS in the same pass. The two
    // hooks operate on different denorm columns + different ledger
    // tables, so a TCS failure doesn't block TDS and vice versa.
    let tdsResult;
    try {
      tdsResult = await this.tdsHook.applyToCycleOnApprove({
        cycleId,
        actorId,
      });
    } catch (err) {
      this.logger.warn(
        `194-O TDS apply-on-approve failed for cycle ${cycleId}: ${(err as Error).message}`,
      );
    }

    return {
      success: true,
      message: 'Settlement cycle approved',
      tcs: tcsResult,
      tds: tdsResult,
    };
  }

  /* ── T3: Mark a seller settlement as paid ── */
  async markSettlementPaid(
    settlementId: string,
    utrReference: string,
    actorContext?: { adminId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: settlementId },
      include: { cycle: true },
    });

    if (!settlement) {
      return { success: false, message: 'Seller settlement not found' };
    }

    if (settlement.status === 'PAID') {
      return { success: false, message: 'Settlement already marked as paid' };
    }

    if (settlement.cycle.status !== 'APPROVED') {
      return {
        success: false,
        message: 'Settlement cycle must be approved before marking paid',
      };
    }

    await this.prisma.$transaction(async (tx) => {
      // Mark seller settlement as paid
      await tx.sellerSettlement.update({
        where: { id: settlementId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          utrReference,
        },
      });

      // Update all linked commission records to SETTLED
      await tx.commissionRecord.updateMany({
        where: { settlementId },
        data: this.moneyDualWrite.applyPaise('commissionRecord', {
          status: 'SETTLED',
        }),
      });

      // Check if all seller settlements in the cycle are paid
      const pendingCount = await tx.sellerSettlement.count({
        where: {
          cycleId: settlement.cycleId,
          status: { not: 'PAID' },
        },
      });

      if (pendingCount === 0) {
        await tx.settlementCycle.update({
          where: { id: settlement.cycleId },
          data: { status: 'PAID' },
        });
      }
    });

    // Phase 17 GST — flip the linked TCS row COMPUTED → COLLECTED so
    // the GSTR-8 export reflects "TCS money actually collected from
    // seller payout". Runs after the transaction commits since the
    // hook does its own writes; if it fails, the payout has already
    // happened and we just need finance to retry markCollected via the
    // admin endpoint.
    try {
      await this.tcsHook.markCollectedOnPay({ settlementId });
    } catch (err) {
      this.logger.warn(
        `TCS mark-collected failed for settlement ${settlementId}: ${(err as Error).message}`,
      );
    }

    // Phase 27 — same pattern for the 194-O TDS row. The TDS amount
    // has been deducted from the seller's payout; flip the ledger
    // COMPUTED → WITHHELD so admin sees it in the "challan-pending"
    // queue. Best-effort: re-runnable via the admin endpoint if it
    // fails here.
    try {
      await this.tdsHook.markWithheldOnPay({ settlementId });
    } catch (err) {
      this.logger.warn(
        `194-O TDS mark-withheld failed for settlement ${settlementId}: ${(err as Error).message}`,
      );
    }

    // Audit the payout — settlement payouts are real money movements and
    // need to be traceable to a specific admin action with the UTR.
    this.audit
      .writeAuditLog({
        actorId: actorContext?.adminId,
        actorRole: 'ADMIN',
        action: 'MARK_SETTLEMENT_PAID',
        module: 'settlements',
        resource: 'seller_settlement',
        resourceId: settlementId,
        oldValue: { status: settlement.status },
        newValue: { status: 'PAID', utrReference },
        metadata: {
          sellerId: settlement.sellerId,
          cycleId: settlement.cycleId,
          amount: Number(settlement.totalSettlementAmount ?? 0),
        },
        ipAddress: actorContext?.ipAddress,
        userAgent: actorContext?.userAgent,
      })
      .catch((err) => {
        this.logger.error(`Audit write failed: ${(err as Error).message}`);
      });

    return { success: true, message: 'Settlement marked as paid' };
  }

  /* ── T4: Seller earnings summary ── */
  async getSellerEarningsSummary(sellerId: string) {
    // Total earned (all SETTLED records)
    const settledAgg = await this.prisma.commissionRecord.aggregate({
      where: { sellerId, status: 'SETTLED' },
      _sum: { totalSettlementAmount: true },
    });

    // Pending settlement (all PENDING records)
    const pendingAgg = await this.prisma.commissionRecord.aggregate({
      where: { sellerId, status: 'PENDING' },
      _sum: { totalSettlementAmount: true },
    });

    // Last payout
    const lastPayout = await this.prisma.sellerSettlement.findFirst({
      where: { sellerId, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      select: {
        totalSettlementAmount: true,
        paidAt: true,
        utrReference: true,
      },
    });

    // Phase B (P0.5) — seller-funded discount deductions. Sum of
    // ledger entries with liability_party=SELLER for this seller.
    // These are amounts the seller has agreed to absorb (reducing
    // their settlement); platform-funded discounts do NOT show here.
    const discountDeductionAgg = await this.prisma.discountLiabilityLedger.aggregate({
      where: {
        sellerId,
        liabilityParty: 'SELLER',
        status: { in: ['APPLIED', 'SETTLED'] },
      },
      _sum: { amountInPaise: true },
      _count: true,
    });

    return {
      totalEarned: Number(settledAgg._sum.totalSettlementAmount || 0),
      pendingSettlement: Number(pendingAgg._sum.totalSettlementAmount || 0),
      lastPayout: lastPayout
        ? {
            amount: Number(lastPayout.totalSettlementAmount),
            paidAt: lastPayout.paidAt,
            utrReference: lastPayout.utrReference,
          }
        : null,
      // Phase B (P0.5)
      discountDeductions: {
        // BigInt → string on the wire (Prisma convention).
        totalAmountInPaise: (
          discountDeductionAgg._sum.amountInPaise ?? 0n
        ).toString(),
        count: discountDeductionAgg._count,
      },
    };
  }

  /**
   * Phase B (P0.5) — paginated list of seller-funded discount
   * deductions for a specific seller. Backs the "Discount
   * Deductions" tab on the seller dashboard.
   */
  async getSellerDiscountDeductions(
    sellerId: string,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.discountLiabilityLedger.findMany({
        where: {
          sellerId,
          liabilityParty: 'SELLER',
          status: { in: ['APPLIED', 'SETTLED'] },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.discountLiabilityLedger.count({
        where: {
          sellerId,
          liabilityParty: 'SELLER',
          status: { in: ['APPLIED', 'SETTLED'] },
        },
      }),
    ]);
    return {
      items: rows.map((r) => ({
        ...r,
        amountInPaise: r.amountInPaise.toString(),
      })),
      total,
      page,
      limit,
    };
  }

  /* ── T4: Seller commission records (paginated) ── */
  async getSellerCommissionRecords(
    sellerId: string,
    page: number,
    limit: number,
    search?: string,
    status?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { sellerId };

    if (status && ['PENDING', 'ON_HOLD', 'SETTLED', 'REFUNDED'].includes(status)) {
      where.status = status;
    } else {
      // Mirror the admin list behaviour: refunded + held commissions are
      // hidden by default. Sellers can opt in by picking the explicit
      // filter. "Held" records will flip back to PENDING automatically
      // when admin rejects the return (seller earns) or stay frozen
      // while the return is in progress.
      where.status = { notIn: ['REFUNDED', 'ON_HOLD'] };
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { productTitle: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [records, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.commissionRecord.count({ where }),
    ]);

    return {
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ── T4: Seller settlement history ── */
  async getSellerSettlementHistory(sellerId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [settlements, total] = await Promise.all([
      this.prisma.sellerSettlement.findMany({
        where: { sellerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          cycle: {
            select: { periodStart: true, periodEnd: true, status: true },
          },
        },
      }),
      this.prisma.sellerSettlement.count({ where: { sellerId } }),
    ]);

    return {
      settlements,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ── T5: Admin margin summary ── */
  async getAdminMarginSummary() {
    const [totalPlatformAgg, totalSettlementAgg, totalMarginAgg] =
      await Promise.all([
        this.prisma.commissionRecord.aggregate({
          _sum: { totalPlatformAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { totalSettlementAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          _sum: { platformMargin: true },
        }),
      ]);

    const pendingSettlements = await this.prisma.commissionRecord.aggregate({
      where: { status: 'PENDING' },
      _sum: { totalSettlementAmount: true },
    });

    const paidSettlements = await this.prisma.sellerSettlement.aggregate({
      where: { status: 'PAID' },
      _sum: { totalSettlementAmount: true },
    });

    return {
      totalPlatformRevenue: Number(totalPlatformAgg._sum.totalPlatformAmount || 0),
      totalSellerPayouts: Number(paidSettlements._sum.totalSettlementAmount || 0),
      totalPlatformMargin: Number(totalMarginAgg._sum.platformMargin || 0),
      pendingSettlementAmount: Number(pendingSettlements._sum.totalSettlementAmount || 0),
      totalSettlementsDue: Number(totalSettlementAgg._sum.totalSettlementAmount || 0),
    };
  }

  /* ── T5: Admin per-seller breakdown ── */
  async getAdminSellerBreakdown(page: number, limit: number) {
    const skip = (page - 1) * limit;

    // Get unique sellers with commission records
    const sellers = await this.prisma.commissionRecord.groupBy({
      by: ['sellerId', 'sellerName'],
      _sum: {
        totalPlatformAmount: true,
        totalSettlementAmount: true,
        platformMargin: true,
      },
      _count: { id: true },
      orderBy: { _sum: { totalPlatformAmount: 'desc' } },
      skip,
      take: limit,
    });

    const total = await this.prisma.commissionRecord.groupBy({
      by: ['sellerId'],
      _count: { id: true },
    });

    return {
      sellers: sellers.map((s) => ({
        sellerId: s.sellerId,
        sellerName: s.sellerName,
        totalRecords: s._count.id,
        totalPlatformAmount: Number(s._sum.totalPlatformAmount || 0),
        totalSettlementAmount: Number(s._sum.totalSettlementAmount || 0),
        totalPlatformMargin: Number(s._sum.platformMargin || 0),
      })),
      pagination: {
        page,
        limit,
        total: total.length,
        totalPages: Math.ceil(total.length / limit),
      },
    };
  }

  /* ── T6: Reconciliation ── */
  async getReconciliation() {
    // Total platform revenue: sum of all commission records totalPlatformAmount
    const platformRevenueAgg = await this.prisma.commissionRecord.aggregate({
      _sum: { totalPlatformAmount: true },
    });

    // Total seller settlements due: sum of all commission records totalSettlementAmount
    const sellerSettlementsAgg = await this.prisma.commissionRecord.aggregate({
      _sum: { totalSettlementAmount: true },
    });

    // Total platform margin
    const marginAgg = await this.prisma.commissionRecord.aggregate({
      _sum: { platformMargin: true },
    });

    // Pending settlements (not yet paid)
    const pendingAgg = await this.prisma.commissionRecord.aggregate({
      where: { status: 'PENDING' },
      _sum: { totalSettlementAmount: true, totalPlatformAmount: true },
      _count: { id: true },
    });

    // Settled (paid)
    const settledAgg = await this.prisma.commissionRecord.aggregate({
      where: { status: 'SETTLED' },
      _sum: { totalSettlementAmount: true },
      _count: { id: true },
    });

    // Total delivered order items (should match with commission records processed)
    const totalDeliveredItems = await this.prisma.orderItem.count({
      where: {
        subOrder: {
          fulfillmentStatus: 'DELIVERED',
          commissionProcessed: true,
        },
      },
    });

    const totalCommissionRecords = await this.prisma.commissionRecord.count();

    // Check for mismatches
    const mismatches: string[] = [];

    if (totalDeliveredItems !== totalCommissionRecords) {
      mismatches.push(
        `Delivered items (${totalDeliveredItems}) vs commission records (${totalCommissionRecords}) mismatch`,
      );
    }

    const totalPlatformRevenue = Number(platformRevenueAgg._sum.totalPlatformAmount || 0);
    const totalSellerSettlements = Number(sellerSettlementsAgg._sum.totalSettlementAmount || 0);
    const totalPlatformMargin = Number(marginAgg._sum.platformMargin || 0);

    // Verify margin = revenue - settlements
    const calculatedMargin = Math.round((totalPlatformRevenue - totalSellerSettlements) * 100) / 100;
    const reportedMargin = Math.round(totalPlatformMargin * 100) / 100;

    if (Math.abs(calculatedMargin - reportedMargin) > 0.01) {
      mismatches.push(
        `Margin mismatch: calculated ${calculatedMargin} vs reported ${reportedMargin}`,
      );
    }

    return {
      totalPlatformRevenue,
      totalSellerSettlements,
      totalPlatformMargin,
      pendingSettlements: {
        count: pendingAgg._count.id,
        amount: Number(pendingAgg._sum.totalSettlementAmount || 0),
        platformAmount: Number(pendingAgg._sum.totalPlatformAmount || 0),
      },
      settledPayments: {
        count: settledAgg._count.id,
        amount: Number(settledAgg._sum.totalSettlementAmount || 0),
      },
      totalDeliveredItems,
      totalCommissionRecords,
      isReconciled: mismatches.length === 0,
      mismatches,
    };
  }

  // ── Adjustments ─────────────────────────────────────────────────

  /**
   * Manual adjustment on a settlement. Allowed only while the parent
   * cycle is APPROVED (not PAID) — once paid, adjustments must be
   * done in the next cycle. Sign convention: positive adds to payout.
   */
  async recordAdjustment(args: {
    settlementId: string;
    amount: number;
    reason: string;
    notes?: string;
    adminId?: string;
  }) {
    if (!Number.isFinite(args.amount) || args.amount === 0) {
      throw new Error('amount must be a non-zero number');
    }
    if (!args.reason?.trim()) {
      throw new Error('reason is required');
    }
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: args.settlementId },
    });
    if (!settlement) throw new Error('Settlement not found');
    if (settlement.status === 'PAID') {
      throw new Error('Cannot adjust a PAID settlement; use a follow-up cycle');
    }

    const adjustment = await this.prisma.settlementAdjustment.create({
      data: this.moneyDualWrite.applyPaise('settlementAdjustment', {
        settlementId: args.settlementId,
        // .toFixed(2) is defensive — args.amount is a JS Number and
        // toPaise refuses fractional Numbers. Most callers pass whole
        // rupee values today, but the conversion is cheap and keeps
        // the call site safe against payload changes.
        amount: args.amount.toFixed(2),
        reason: args.reason.trim(),
        notes: args.notes?.trim() || null,
        createdByAdminId: args.adminId ?? null,
      }),
    });

    // Increment-operator dual-write: the MoneyDualWriteHelper only
    // supports `set:` (its header comment is explicit about this), so
    // we hand-compute the paise increment via the same toPaise() the
    // helper uses internally. Keeping both columns in lockstep on an
    // atomic Postgres-side increment is the only correct shape here.
    const amountInPaiseIncrement = toPaise(args.amount.toFixed(2));
    await this.prisma.sellerSettlement.update({
      where: { id: args.settlementId },
      data: {
        totalSettlementAmount: { increment: args.amount },
        ...(amountInPaiseIncrement !== null
          ? { totalSettlementAmountInPaise: { increment: amountInPaiseIncrement } }
          : {}),
      },
    });

    await this.audit.writeAuditLog({
      actorId: args.adminId,
      action: 'settlement.adjust',
      module: 'settlements',
      resource: 'sellerSettlement',
      resourceId: args.settlementId,
      newValue: { amount: args.amount, reason: args.reason },
    });

    return adjustment;
  }

  async listAdjustments(settlementId: string) {
    return this.prisma.settlementAdjustment.findMany({
      where: { settlementId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Phase 3.5 (2026-05-16) — Tally / accounting-package CSV export.
   *
   * Generates a CSV in the format Tally Prime expects for the "Import
   * Vouchers" workflow. One row per SellerSettlement in the cycle.
   * Columns:
   *   - Voucher Date         (cycle.periodEnd in DD/MM/YYYY)
   *   - Voucher No           (auto: SM/<cycleId-short>/<index>)
   *   - Voucher Type         (always "Payment" — Tally's standard for
   *                          marketplace-to-seller settlements)
   *   - Particulars (DR)     (the seller's name — Tally maps this to
   *                          their pre-created ledger account)
   *   - Particulars (CR)     ("SportSmart Bank" — our payout bank ledger)
   *   - Amount               (Rupees with 2 decimal places)
   *   - Narration            (seller-readable description with cycle
   *                          + period + commission summary)
   *
   * The exported file is what finance hands to their book-keeper for
   * monthly close. Once Tally / QuickBooks / Zoho all accept the same
   * shape (with minor header tweaks), this becomes the single source
   * for any accounting-package export. Future task: refactor into a
   * pluggable formatter (`TallyAccountingExporter`,
   * `QuickBooksAccountingExporter`) once we have a second consumer.
   */
  async exportCycleToTallyCsv(cycleId: string): Promise<string> {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
      include: {
        sellerSettlements: {
          include: {
            seller: { select: { sellerShopName: true, sellerName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!cycle) throw new Error(`SettlementCycle ${cycleId} not found`);

    const dateStr = formatDDMMYYYY(cycle.periodEnd ?? new Date());
    const cycleShort = cycle.id.slice(0, 8).toUpperCase();
    const periodStr =
      cycle.periodStart && cycle.periodEnd
        ? `${formatDDMMYYYY(cycle.periodStart)} to ${formatDDMMYYYY(cycle.periodEnd)}`
        : 'unknown period';

    const rows = cycle.sellerSettlements.map((s, idx) => {
      const sellerLabel =
        s.seller?.sellerShopName?.trim() ||
        s.seller?.sellerName?.trim() ||
        `Seller ${s.sellerId.slice(0, 8)}`;
      const amount = Number(s.totalSettlementAmount).toFixed(2);
      const margin = Number(s.totalPlatformMargin ?? 0).toFixed(2);
      const narration =
        `Settlement ${cycleShort} for ${sellerLabel} — ` +
        `${periodStr}, items=${s.totalItems ?? 0}, ` +
        `platform margin Rs ${margin}`;
      const voucherNo = `SM/${cycleShort}/${(idx + 1).toString().padStart(4, '0')}`;
      // CSV quoting: wrap any field containing comma / quote / newline.
      return [
        dateStr,
        voucherNo,
        'Payment',
        csvQuote(sellerLabel),
        '"SportSmart Bank"',
        amount,
        csvQuote(narration),
      ].join(',');
    });

    const header =
      'Voucher Date,Voucher No,Voucher Type,Particulars (DR),Particulars (CR),Amount,Narration';
    return [header, ...rows].join('\n');
  }

  /**
   * Phase 3.5 — opening / closing balance per seller for a cycle.
   *
   * Opening balance = sum of every PAID settlement amount for this
   * seller BEFORE the cycle start. Closing balance = opening + this
   * cycle's settlement. Used by finance for monthly close
   * reconciliation alongside the Tally CSV export.
   *
   * Read-only — no writes, no side effects.
   */
  async computeOpeningClosingBalance(
    cycleId: string,
  ): Promise<
    Array<{
      sellerId: string;
      sellerName: string;
      openingBalanceInPaise: string;
      cycleAmountInPaise: string;
      closingBalanceInPaise: string;
    }>
  > {
    const cycle = await this.prisma.settlementCycle.findUnique({
      where: { id: cycleId },
      include: {
        sellerSettlements: {
          include: { seller: { select: { sellerShopName: true } } },
        },
      },
    });
    if (!cycle || !cycle.periodStart) {
      throw new Error(`SettlementCycle ${cycleId} not found or has no periodStart`);
    }
    const out: Array<{
      sellerId: string;
      sellerName: string;
      openingBalanceInPaise: string;
      cycleAmountInPaise: string;
      closingBalanceInPaise: string;
    }> = [];

    for (const s of cycle.sellerSettlements) {
      // Sum every PAID settlement (paise sibling) for this seller
      // BEFORE the cycle start.
      const prior = await this.prisma.sellerSettlement.findMany({
        where: {
          sellerId: s.sellerId,
          status: 'PAID',
          createdAt: { lt: cycle.periodStart },
        },
        select: { totalSettlementAmountInPaise: true },
      });
      const openingInPaise = prior.reduce(
        (sum, r) => sum + (r.totalSettlementAmountInPaise ?? 0n),
        0n,
      );
      const cycleAmountInPaise = s.totalSettlementAmountInPaise ?? 0n;
      const closingInPaise = openingInPaise + cycleAmountInPaise;
      out.push({
        sellerId: s.sellerId,
        sellerName:
          s.seller?.sellerShopName?.trim() ?? `Seller ${s.sellerId.slice(0, 8)}`,
        openingBalanceInPaise: openingInPaise.toString(),
        cycleAmountInPaise: cycleAmountInPaise.toString(),
        closingBalanceInPaise: closingInPaise.toString(),
      });
    }
    return out;
  }
}

function formatDDMMYYYY(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function csvQuote(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
