import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AccountsRepository } from '../../domain/repositories/accounts.repository.interface';
import { Prisma } from '@prisma/client';
// Phase 251 — single source of truth for the settlement net payable.
import { settlementNetFromRow } from '../../../settlements/domain/settlement-net';
import type { SettlementAdjustmentType } from '@prisma/client';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

const ZERO = new Prisma.Decimal(0);

/**
 * Phase 175 (Accounts Overview audit #3) — money is serialized as an EXACT
 * 2-decimal rupee string at the repository boundary. The old code did
 * `Number(decimal || 0)`, which loses precision above 2^53 and injects
 * float-format noise into the JSON. `Prisma.Decimal.toFixed` is exact decimal
 * formatting; BigInt paise are formatted by hand. Never coerce money to Number.
 */
function money(d: Prisma.Decimal | null | undefined): string {
  return (d ?? ZERO).toFixed(2);
}
function dec(d: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return d ?? ZERO;
}
/** Exact BigInt paise → 2-decimal rupee string. */
function paiseToRupees(p: bigint | null | undefined): string {
  const v = p ?? 0n;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
/**
 * Phase 175 (#4/#17) — one consistent date window. `toDate` is INCLUSIVE (the
 * controller normalises a bare calendar date to end-of-day), so `lte` is
 * correct. Returns `{}` when unbounded so it can be spread into a where-clause.
 */
type DateWindow = { gte?: Date; lte?: Date };
type DateField = 'createdAt' | 'paidAt' | 'computedAt' | 'soldAt' | 'returnedAt';
function dateRange(
  field: DateField,
  from?: Date,
  to?: Date,
): Partial<Record<DateField, DateWindow>> {
  if (!from && !to) return {};
  const r: DateWindow = {};
  if (from) r.gte = from;
  if (to) r.lte = to;
  return { [field]: r };
}

/** Phase 176 — mask a PAN to its last 4 (finance dashboards show, don't leak). */
function maskPan(pan: string | null): string | null {
  if (!pan) return null;
  return pan.length <= 4 ? pan : `${'•'.repeat(pan.length - 4)}${pan.slice(-4)}`;
}

@Injectable()
export class PrismaAccountsRepository implements AccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Platform-wide KPIs ─────────────────────────────────────

  async getPlatformFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }) {
    // Phase 175 (#4/#17) — period-scoped data filters on createdAt; "settled in
    // the window" filters on paidAt. Both are now applied CONSISTENTLY (the old
    // code left every settlement aggregate unfiltered, so the date picker lied).
    const created = dateRange('createdAt', params?.fromDate, params?.toDate);
    const paid = dateRange('paidAt', params?.fromDate, params?.toDate);

    const [
      sellerCommissionAgg,
      franchiseLedgerAgg,
      franchiseProcurementAgg,
      pendingSellerCount,
      pendingFranchiseCount,
      settledSellerAgg,
      settledFranchiseAgg,
      pendingSellerAgg,
      pendingFranchiseAgg,
      affiliateAgg,
      chargebackAgg,
    ] = await Promise.all([
      this.prisma.commissionRecord.aggregate({
        where: created,
        _sum: {
          totalPlatformAmount: true,
          totalSettlementAmount: true,
          platformMargin: true,
          // Phase 175 (#9/#8) — refunds + tax-on-commission, surfaced separately.
          refundedAdminEarning: true,
          taxCommission: true,
          vatOnCommission: true,
        },
      }),
      this.prisma.franchiseFinanceLedger.aggregate({
        where: { ...created, sourceType: 'ONLINE_ORDER', status: { not: 'REVERSED' } },
        _sum: { platformEarning: true, franchiseEarning: true },
      }),
      this.prisma.franchiseFinanceLedger.aggregate({
        where: { ...created, sourceType: 'PROCUREMENT_FEE', status: { not: 'REVERSED' } },
        _sum: { platformEarning: true },
      }),
      // #4 — pending counts/amounts scoped to settlements CREATED in the window.
      this.prisma.sellerSettlement.count({ where: { status: 'PENDING', ...created } }),
      this.prisma.franchiseSettlement.count({ where: { status: 'PENDING', ...created } }),
      // #4 — settled aggregates scoped to settlements PAID in the window.
      this.prisma.sellerSettlement.aggregate({
        where: { status: 'PAID', ...paid },
        _sum: { totalSettlementAmount: true },
      }),
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PAID', ...paid },
        _sum: { netPayableToFranchise: true },
      }),
      this.prisma.sellerSettlement.aggregate({
        where: { status: 'PENDING', ...created },
        _sum: { totalSettlementAmount: true },
      }),
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PENDING', ...created },
        _sum: { netPayableToFranchise: true },
      }),
      // #16 — affiliate commission paid in the window (surfaced separately).
      this.prisma.affiliateCommission.aggregate({
        where: { status: 'PAID', ...paid },
        _sum: { adjustedAmount: true },
      }),
      // #10 — chargeback exposure: money OPEN (at risk) or LOST. Point-in-time.
      this.prisma.chargeback.aggregate({
        where: { status: { in: ['OPEN', 'LOST'] } },
        _sum: { amountInPaise: true },
      }),
    ]);

    const grossRevenue = dec(sellerCommissionAgg._sum.totalPlatformAmount);
    const refunded = dec(sellerCommissionAgg._sum.refundedAdminEarning);
    const taxOnCommission = dec(sellerCommissionAgg._sum.taxCommission).plus(
      dec(sellerCommissionAgg._sum.vatOnCommission),
    );
    // Phase 175 (#7) — these are platform COMMISSIONS (not "margin"); the sum is
    // explicitly labelled totalPlatformCommissions. Margin would require
    // subtracting platform-borne costs, which this dataset doesn't carry.
    const totalPlatformCommissions = dec(sellerCommissionAgg._sum.platformMargin)
      .plus(dec(franchiseLedgerAgg._sum.platformEarning))
      .plus(dec(franchiseProcurementAgg._sum.platformEarning));

    return {
      currency: 'INR', // #20
      // ── Revenue (gross, refunds, net, tax shown separately) ──
      totalPlatformRevenue: money(sellerCommissionAgg._sum.totalPlatformAmount), // gross seller commission base
      totalRefundedFromCommission: money(sellerCommissionAgg._sum.refundedAdminEarning), // #9
      netPlatformRevenue: grossRevenue.minus(refunded).toFixed(2), // #9 — revenue less refunds
      totalTaxOnCommission: taxOnCommission.toFixed(2), // #8 — GST/VAT on commission, NOT counted as platform revenue
      // ── Platform commissions (#7 relabeled from the misleading "earnings") ──
      totalPlatformCommissions: totalPlatformCommissions.toFixed(2),
      totalPlatformEarnings: totalPlatformCommissions.toFixed(2), // back-compat alias
      totalSellerCommission: money(sellerCommissionAgg._sum.platformMargin),
      totalFranchiseCommission: money(franchiseLedgerAgg._sum.platformEarning),
      totalProcurementFees: money(franchiseProcurementAgg._sum.platformEarning),
      totalAffiliateCommissionPaid: money(affiliateAgg._sum.adjustedAmount), // #16
      // ── Payables ──
      totalSellerPayables: money(pendingSellerAgg._sum.totalSettlementAmount),
      totalFranchisePayables: money(pendingFranchiseAgg._sum.netPayableToFranchise),
      pendingSellerSettlements: pendingSellerCount,
      pendingFranchiseSettlements: pendingFranchiseCount,
      totalSettledToSellers: money(settledSellerAgg._sum.totalSettlementAmount), // #4 paidAt-scoped
      totalSettledToFranchises: money(settledFranchiseAgg._sum.netPayableToFranchise),
      // ── Exposure ──
      chargebackExposure: paiseToRupees(chargebackAgg._sum.amountInPaise), // #10
      // ── Drill-down link sources (#14) ──
      linkSources: {
        sellerSettlementsUrl: '/dashboard/finance/settlements?nodeType=SELLER',
        franchiseSettlementsUrl: '/dashboard/finance/settlements?nodeType=FRANCHISE',
        commissionRecordsUrl: '/dashboard/commission',
        refundApprovalsUrl: '/dashboard/finance/refund-approvals',
      },
    };
  }

  // ── Seller financial overview ──────────────────────────────

  async getSellerFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }) {
    const created = dateRange('createdAt', params?.fromDate, params?.toDate);
    const paid = dateRange('paidAt', params?.fromDate, params?.toDate);

    const [
      totalSellers,
      activeSellers,
      commissionAgg,
      totalCommissionRecords,
      pendingAgg,
      settledAgg,
    ] = await Promise.all([
      this.prisma.seller.count({ where: { isDeleted: false } }),
      this.prisma.seller.count({
        where: { isDeleted: false, status: 'ACTIVE' },
      }),
      this.prisma.commissionRecord.aggregate({
        where: created,
        _sum: {
          totalPlatformAmount: true,
          totalSettlementAmount: true,
          platformMargin: true,
          refundedAdminEarning: true,
        },
      }),
      this.prisma.commissionRecord.count({ where: created }),
      this.prisma.commissionRecord.aggregate({
        where: { ...created, status: 'PENDING' },
        _sum: { totalSettlementAmount: true },
      }),
      // Phase 175 (#4) — settled scoped to settlements PAID in the window.
      this.prisma.sellerSettlement.aggregate({
        where: { status: 'PAID', ...paid },
        _sum: { totalSettlementAmount: true },
      }),
    ]);

    return {
      currency: 'INR', // #20
      totalSellers,
      activeSellers,
      totalCommissionRecords,
      totalPlatformAmount: money(commissionAgg._sum.totalPlatformAmount),
      totalSettlementAmount: money(commissionAgg._sum.totalSettlementAmount),
      totalPlatformMargin: money(commissionAgg._sum.platformMargin),
      totalRefundedFromCommission: money(commissionAgg._sum.refundedAdminEarning), // #9
      pendingSettlementAmount: money(pendingAgg._sum.totalSettlementAmount),
      settledAmount: money(settledAgg._sum.totalSettlementAmount),
    };
  }

  // ── Franchise financial overview ───────────────────────────

  async getFranchiseFinanceSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
  }) {
    const created = dateRange('createdAt', params?.fromDate, params?.toDate);
    const paid = dateRange('paidAt', params?.fromDate, params?.toDate);

    const [
      totalFranchises,
      activeFranchises,
      totalLedgerEntries,
      onlineOrderAgg,
      procurementAgg,
      allLedgerAgg,
      pendingFranchiseAgg,
      settledFranchiseAgg,
    ] = await Promise.all([
      this.prisma.franchisePartner.count({ where: { isDeleted: false } }),
      this.prisma.franchisePartner.count({
        where: { isDeleted: false, status: 'ACTIVE' },
      }),
      this.prisma.franchiseFinanceLedger.count({
        where: { ...created, status: { not: 'REVERSED' } },
      }),
      this.prisma.franchiseFinanceLedger.aggregate({
        where: { ...created, sourceType: 'ONLINE_ORDER', status: { not: 'REVERSED' } },
        _sum: { platformEarning: true },
      }),
      this.prisma.franchiseFinanceLedger.aggregate({
        where: { ...created, sourceType: 'PROCUREMENT_FEE', status: { not: 'REVERSED' } },
        _sum: { platformEarning: true },
      }),
      this.prisma.franchiseFinanceLedger.aggregate({
        where: { ...created, status: { not: 'REVERSED' } },
        _sum: { franchiseEarning: true },
      }),
      // Phase 175 (#4) — pending scoped to createdAt, settled scoped to paidAt.
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PENDING', ...created },
        _sum: { netPayableToFranchise: true },
      }),
      this.prisma.franchiseSettlement.aggregate({
        where: { status: 'PAID', ...paid },
        _sum: { netPayableToFranchise: true },
      }),
    ]);

    return {
      currency: 'INR', // #20
      totalFranchises,
      activeFranchises,
      totalLedgerEntries,
      totalOnlineOrderCommission: money(onlineOrderAgg._sum.platformEarning),
      totalProcurementFees: money(procurementAgg._sum.platformEarning),
      totalFranchiseEarnings: money(allLedgerAgg._sum.franchiseEarning),
      pendingSettlementAmount: money(pendingFranchiseAgg._sum.netPayableToFranchise),
      settledAmount: money(settledFranchiseAgg._sum.netPayableToFranchise),
    };
  }

  // ── Unified payables list ──────────────────────────────────

  async getPayablesSummary(params: {
    page: number;
    limit: number;
    nodeType?: 'SELLER' | 'FRANCHISE' | 'ALL';
    status?: 'PENDING' | 'APPROVED' | 'PAID';
    search?: string;
  }) {
    const nodeType = params.nodeType || 'ALL';
    const payables: Array<{
      nodeType: 'SELLER' | 'FRANCHISE';
      nodeId: string;
      nodeName: string;
      totalOrders: number;
      totalAmount: string;
      platformEarning: string;
      pendingAmount: string;
      settledAmount: string;
      lastPaidAt: Date | null;
    }> = [];

    const OUTSTANDING = new Set(['PENDING', 'APPROVED', 'READY_FOR_PAYOUT', 'FAILED', 'PARTIALLY_PAID']);

    // Fetch seller payables — Phase 178 (#6) NO N+1: ONE groupBy by
    // (sellerId, sellerName, status) splits pending/paid in a single query; a
    // second groupBy gets last-paid. (#3) pending is NET of statutory deductions.
    if (nodeType === 'ALL' || nodeType === 'SELLER') {
      const where: Prisma.SellerSettlementWhereInput = params.search
        ? { sellerName: { contains: params.search, mode: 'insensitive' } }
        : {};
      const [grouped, lastPaidRows] = await Promise.all([
        this.prisma.sellerSettlement.groupBy({
          by: ['sellerId', 'sellerName', 'status'],
          where,
          _count: { id: true },
          _sum: {
            totalSettlementAmountInPaise: true, tcsDeductedInPaise: true,
            tdsDeductedInPaise: true, totalCommissionGstInPaise: true,
            paidAmountInPaise: true, totalPlatformMargin: true,
          },
        }),
        this.prisma.sellerSettlement.groupBy({
          by: ['sellerId'],
          where: { ...where, status: 'PAID' },
          _max: { paidAt: true },
        }),
      ]);
      const lastPaidById = new Map(lastPaidRows.map((r) => [r.sellerId, r._max.paidAt]));
      type Acc = { name: string; orders: number; margin: Prisma.Decimal; pendingPaise: bigint; paidPaise: bigint; hasStatus: boolean };
      const acc = new Map<string, Acc>();
      for (const g of grouped) {
        const cur = acc.get(g.sellerId) ?? { name: g.sellerName, orders: 0, margin: ZERO, pendingPaise: 0n, paidPaise: 0n, hasStatus: !params.status };
        cur.orders += g._count.id;
        cur.margin = cur.margin.plus(dec(g._sum.totalPlatformMargin));
        const net = (g._sum.totalSettlementAmountInPaise ?? 0n) - (g._sum.tcsDeductedInPaise ?? 0n) - (g._sum.tdsDeductedInPaise ?? 0n) - (g._sum.totalCommissionGstInPaise ?? 0n) - (g._sum.paidAmountInPaise ?? 0n);
        if (OUTSTANDING.has(g.status)) cur.pendingPaise += net;
        if (g.status === 'PAID') cur.paidPaise += (g._sum.totalSettlementAmountInPaise ?? 0n);
        if (params.status && g.status === params.status) cur.hasStatus = true;
        acc.set(g.sellerId, cur);
      }
      for (const [sellerId, v] of acc) {
        if (!v.hasStatus) continue;
        payables.push({
          nodeType: 'SELLER', nodeId: sellerId, nodeName: v.name, totalOrders: v.orders,
          totalAmount: paiseToRupees(v.pendingPaise),
          platformEarning: v.margin.toFixed(2),
          pendingAmount: paiseToRupees(v.pendingPaise),
          settledAmount: paiseToRupees(v.paidPaise),
          lastPaidAt: lastPaidById.get(sellerId) ?? null,
        });
      }
    }

    // Fetch franchise payables — same constant-query pattern.
    if (nodeType === 'ALL' || nodeType === 'FRANCHISE') {
      const where: Prisma.FranchiseSettlementWhereInput = params.search
        ? { franchiseName: { contains: params.search, mode: 'insensitive' } }
        : {};
      const [grouped, lastPaidRows] = await Promise.all([
        this.prisma.franchiseSettlement.groupBy({
          by: ['franchiseId', 'franchiseName', 'status'],
          where,
          _count: { id: true },
          _sum: { netPayableToFranchise: true, totalPlatformEarning: true, paidAmountInPaise: true },
        }),
        this.prisma.franchiseSettlement.groupBy({
          by: ['franchiseId'],
          where: { ...where, status: 'PAID' },
          _max: { paidAt: true },
        }),
      ]);
      const lastPaidById = new Map(lastPaidRows.map((r) => [r.franchiseId, r._max.paidAt]));
      type Acc = { name: string; orders: number; earning: Prisma.Decimal; pendingPaise: bigint; paidPaise: bigint; hasStatus: boolean };
      const acc = new Map<string, Acc>();
      for (const g of grouped) {
        const cur = acc.get(g.franchiseId) ?? { name: g.franchiseName, orders: 0, earning: ZERO, pendingPaise: 0n, paidPaise: 0n, hasStatus: !params.status };
        cur.orders += g._count.id;
        cur.earning = cur.earning.plus(dec(g._sum.totalPlatformEarning));
        const grossPaise = BigInt(dec(g._sum.netPayableToFranchise).times(100).toFixed(0));
        const net = grossPaise - (g._sum.paidAmountInPaise ?? 0n);
        if (OUTSTANDING.has(g.status)) cur.pendingPaise += net;
        if (g.status === 'PAID') cur.paidPaise += grossPaise;
        if (params.status && g.status === params.status) cur.hasStatus = true;
        acc.set(g.franchiseId, cur);
      }
      for (const [franchiseId, v] of acc) {
        if (!v.hasStatus) continue;
        payables.push({
          nodeType: 'FRANCHISE', nodeId: franchiseId, nodeName: v.name, totalOrders: v.orders,
          totalAmount: paiseToRupees(v.pendingPaise),
          platformEarning: v.earning.toFixed(2),
          pendingAmount: paiseToRupees(v.pendingPaise),
          settledAmount: paiseToRupees(v.paidPaise),
          lastPaidAt: lastPaidById.get(franchiseId) ?? null,
        });
      }
    }

    // Sort by pending amount descending (string money → numeric compare).
    payables.sort((a, b) => Number(b.pendingAmount) - Number(a.pendingAmount));

    // Paginate
    const total = payables.length;
    const start = (params.page - 1) * params.limit;
    const paginated = payables.slice(start, start + params.limit);

    return { payables: paginated, total };
  }

  // ── Settlement cycles (unified view) ───────────────────────

  async getSettlementCycles(params: {
    page: number;
    limit: number;
    status?: string;
  }) {
    const skip = (params.page - 1) * params.limit;
    const where: any = {};
    if (params.status) {
      where.status = params.status;
    }

    const [rawCycles, total] = await Promise.all([
      this.prisma.settlementCycle.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
        include: {
          sellerSettlements: {
            select: {
              totalSettlementAmount: true,
              totalPlatformMargin: true,
            },
          },
          franchiseSettlements: {
            select: {
              netPayableToFranchise: true,
              totalPlatformEarning: true,
            },
          },
          _count: {
            select: {
              sellerSettlements: true,
              franchiseSettlements: true,
            },
          },
        },
      }),
      this.prisma.settlementCycle.count({ where }),
    ]);

    const cycles = rawCycles.map((c) => {
      const totalSellerPayable = c.sellerSettlements.reduce(
        (sum, s) => sum + Number(s.totalSettlementAmount || 0),
        0,
      );
      const totalFranchisePayable = c.franchiseSettlements.reduce(
        (sum, f) => sum + Number(f.netPayableToFranchise || 0),
        0,
      );
      const sellerPlatformEarning = c.sellerSettlements.reduce(
        (sum, s) => sum + Number(s.totalPlatformMargin || 0),
        0,
      );
      const franchisePlatformEarning = c.franchiseSettlements.reduce(
        (sum, f) => sum + Number(f.totalPlatformEarning || 0),
        0,
      );

      return {
        id: c.id,
        periodStart: c.periodStart,
        periodEnd: c.periodEnd,
        status: c.status,
        sellerSettlementCount: c._count.sellerSettlements,
        franchiseSettlementCount: c._count.franchiseSettlements,
        totalSellerPayable: Math.round(totalSellerPayable * 100) / 100,
        totalFranchisePayable:
          Math.round(totalFranchisePayable * 100) / 100,
        totalPlatformEarning:
          Math.round(
            (sellerPlatformEarning + franchisePlatformEarning) * 100,
          ) / 100,
        createdAt: c.createdAt,
      };
    });

    return { cycles, total };
  }

  // ── Revenue breakdown ──────────────────────────────────────

  async getRevenueBreakdown(params: {
    fromDate: Date;
    toDate: Date;
    groupBy: 'day' | 'week' | 'month';
  }) {
    // Phase 180 — `unit` is a constant chosen from a fixed allow-list, so it is
    // safe to interpolate via Prisma.raw (never user-controlled).
    const unit =
      params.groupBy === 'week' ? 'week' : params.groupBy === 'month' ? 'month' : 'day';
    const moPeriod = Prisma.raw(`date_trunc('${unit}', mo.created_at)`);
    const crPeriod = Prisma.raw(`date_trunc('${unit}', cr.created_at)`);
    const rtPeriod = Prisma.raw(`date_trunc('${unit}', r.refund_processed_at)`);

    // #3 — only REALIZED orders count as revenue; CANCELLED / REJECTED /
    // never-paid PENDING_PAYMENT are excluded. #4(fan-out) — revenue is summed
    // from master_orders WITHOUT joining sub_orders, so a multi-sub-order order
    // is NOT double-counted (the old LEFT JOIN multiplied total_amount).
    const [revenueRows, splitRows, marginRows, refundRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ period: Date; total_revenue: Prisma.Decimal | null }>>(Prisma.sql`
        SELECT ${moPeriod} AS period, SUM(mo.total_amount) AS total_revenue
        FROM master_orders mo
        WHERE mo.created_at >= ${params.fromDate} AND mo.created_at <= ${params.toDate}
          AND mo.order_status NOT IN ('CANCELLED','REJECTED','PENDING_PAYMENT')
        GROUP BY period
      `),
      // Seller/franchise fulfilled split — sub_total is per-sub-order (no fan-out).
      this.prisma.$queryRaw<Array<{ period: Date; node: string; amount: Prisma.Decimal | null }>>(Prisma.sql`
        SELECT ${moPeriod} AS period, so.fulfillment_node_type AS node, SUM(so.sub_total) AS amount
        FROM sub_orders so JOIN master_orders mo ON mo.id = so.master_order_id
        WHERE mo.created_at >= ${params.fromDate} AND mo.created_at <= ${params.toDate}
          AND mo.order_status NOT IN ('CANCELLED','REJECTED','PENDING_PAYMENT')
        GROUP BY period, so.fulfillment_node_type
      `),
      // #4 — platform earning is the COMMISSION margin (net of refunded admin
      // earning), NOT the meaningless "total − subtotals" residual.
      this.prisma.$queryRaw<Array<{ period: Date; margin: Prisma.Decimal | null }>>(Prisma.sql`
        SELECT ${crPeriod} AS period,
               SUM(cr.platform_margin) - SUM(cr.refunded_admin_earning) AS margin
        FROM commission_records cr
        WHERE cr.created_at >= ${params.fromDate} AND cr.created_at <= ${params.toDate}
        GROUP BY period
      `),
      // #11 — refunds PROCESSED in the period reduce realized revenue (paise,
      // exact). Bucketed by refund date, surfaced separately (a June refund of a
      // May order belongs to June, not mis-attributed back to May).
      this.prisma.$queryRaw<Array<{ period: Date; refunded: bigint | null }>>(Prisma.sql`
        SELECT ${rtPeriod} AS period, SUM(r.refund_amount_in_paise)::bigint AS refunded
        FROM returns r
        WHERE r.refund_processed_at >= ${params.fromDate} AND r.refund_processed_at <= ${params.toDate}
          AND r.refund_amount_in_paise IS NOT NULL
        GROUP BY period
      `),
    ]);

    // Merge the four period-keyed result sets.
    const byKey = new Map<string, {
      period: Date;
      totalRevenue: Prisma.Decimal;
      seller: Prisma.Decimal;
      franchise: Prisma.Decimal;
      margin: Prisma.Decimal;
      refunds: bigint;
    }>();
    const slot = (period: Date) => {
      const key = period.toISOString();
      let s = byKey.get(key);
      if (!s) {
        s = { period, totalRevenue: ZERO, seller: ZERO, franchise: ZERO, margin: ZERO, refunds: 0n };
        byKey.set(key, s);
      }
      return s;
    };
    for (const r of revenueRows) slot(r.period).totalRevenue = dec(r.total_revenue);
    for (const r of splitRows) {
      const s = slot(r.period);
      if (r.node === 'SELLER') s.seller = dec(r.amount);
      else if (r.node === 'FRANCHISE') s.franchise = dec(r.amount);
    }
    for (const r of marginRows) slot(r.period).margin = dec(r.margin);
    for (const r of refundRows) slot(r.period).refunds = r.refunded ?? 0n;

    return Array.from(byKey.values())
      .sort((a, b) => a.period.getTime() - b.period.getTime())
      .map((s) => {
        const refunds = paiseToRupees(s.refunds);
        return {
          period: s.period.toISOString(),
          // #10 — money is exact 2-decimal STRINGS, never JS Number.
          totalRevenue: s.totalRevenue.toFixed(2),
          refunds, // #11
          netRevenue: s.totalRevenue.minus(dec(new Prisma.Decimal(refunds))).toFixed(2), // #11
          sellerFulfilledAmount: s.seller.toFixed(2),
          franchiseFulfilledAmount: s.franchise.toFixed(2),
          // #4 — commission-derived platform margin (the old residual is gone).
          platformCommissionMargin: s.margin.toFixed(2),
        };
      });
  }

  // ── Top sellers ────────────────────────────────────────────

  async getTopSellers(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
    offset = 0,
    metric: 'REVENUE' | 'MARGIN' = 'REVENUE', // Phase 179 (#1)
  ) {
    const where = dateRange('createdAt', fromDate, toDate);

    // Phase 179 (#16) — exclude internal/demo/test sellers from the leaderboard.
    const internal = await this.prisma.seller.findMany({
      where: { isInternal: true },
      select: { id: true },
    });
    const internalIds = internal.map((s) => s.id);

    const sellers = await this.prisma.commissionRecord.groupBy({
      by: ['sellerId', 'sellerName'],
      where: { ...where, ...(internalIds.length ? { sellerId: { notIn: internalIds } } : {}) },
      _sum: {
        totalPlatformAmount: true,
        platformMargin: true,
        // Phase 176 (#6) — refunds/reversals must not inflate ranked revenue.
        refundedAdminEarning: true,
      },
      _count: { subOrderId: true },
      // Phase 179 (#1) — rank by the chosen metric; (#11) deterministic
      // tie-break on sellerId so equal totals never reorder between refreshes.
      orderBy:
        metric === 'MARGIN'
          ? [{ _sum: { platformMargin: 'desc' } }, { sellerId: 'asc' }]
          : [{ _sum: { totalPlatformAmount: 'desc' } }, { sellerId: 'asc' }],
      take: limit,
      skip: offset, // #19 pagination
    });

    return sellers.map((s, i) => {
      // #6 — net of refunds (CommissionRecordStatus has no REVERSED; REFUNDED
      // records carry their reversal in refundedAdminEarning).
      const totalRevenue = dec(s._sum.totalPlatformAmount).minus(dec(s._sum.refundedAdminEarning));
      const platformMargin = dec(s._sum.platformMargin);
      return {
        rank: offset + i + 1, // #11 — explicit 1-based rank
        sellerId: s.sellerId,
        sellerName: s.sellerName,
        totalOrders: s._count.subOrderId,
        totalRevenue: totalRevenue.toFixed(2),
        platformMargin: platformMargin.toFixed(2),
        marginPercentage: totalRevenue.gt(0)
          ? platformMargin.div(totalRevenue).times(100).toDecimalPlaces(2).toNumber()
          : 0,
      };
    });
  }

  // ── Top franchises ─────────────────────────────────────────

  async getTopFranchises(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
    offset = 0,
    metric: 'REVENUE' | 'MARGIN' = 'REVENUE', // Phase 179 (#1)
  ) {
    const created = dateRange('createdAt', fromDate, toDate);
    const sold = dateRange('soldAt', fromDate, toDate);
    const returned = dateRange('returnedAt', fromDate, toDate);

    // Phase 179 (#5/#6) — revenue & margin defined EXACTLY as the #177
    // per-franchise drill-down so the leaderboard reconciles with it:
    //   revenue = ONLINE_ORDER ledger base + POS net (sale − void − return)
    //   margin  = ONLINE_ORDER platformEarning + PROCUREMENT_FEE platformEarning
    // The old "Σ baseAmount over ALL ledger sources" both EXCLUDED POS and
    // INFLATED revenue with procurement/adjustment/penalty rows. POS is sourced
    // from franchisePosSale (not ledger POS_SALE) to match the drill-down and
    // avoid double-counting. Because revenue spans two tables, ranking is done
    // in-process over the franchise set (bounded — a physical-store network),
    // not via a single DB ORDER BY.
    const [onlineAgg, procAgg, posAgg, posReturnAgg, partners] = await Promise.all([
      this.prisma.franchiseFinanceLedger.groupBy({
        by: ['franchiseId'],
        where: { ...created, sourceType: 'ONLINE_ORDER', status: { not: 'REVERSED' } },
        _sum: { baseAmount: true, platformEarning: true },
        _count: { id: true },
      }),
      this.prisma.franchiseFinanceLedger.groupBy({
        by: ['franchiseId'],
        where: { ...created, sourceType: 'PROCUREMENT_FEE', status: { not: 'REVERSED' } },
        _sum: { platformEarning: true },
        _count: { id: true },
      }),
      // POS net: active sales (voidedAt null) minus returns. Mirrors #177.
      this.prisma.franchisePosSale.groupBy({
        by: ['franchiseId'],
        where: { ...sold, voidedAt: null },
        _sum: { netAmount: true },
        _count: { id: true },
      }),
      this.prisma.franchisePosReturn.groupBy({
        by: ['franchiseId'],
        where: { ...returned },
        _sum: { refundAmount: true },
      }),
      // #16 — only non-internal franchises are eligible for the leaderboard.
      this.prisma.franchisePartner.findMany({
        where: { isInternal: false },
        select: { id: true, businessName: true },
      }),
    ]);

    const nameById = new Map(partners.map((p) => [p.id, p.businessName]));
    const online = new Map(onlineAgg.map((e) => [e.franchiseId, e]));
    const proc = new Map(procAgg.map((e) => [e.franchiseId, e]));
    const pos = new Map(posAgg.map((e) => [e.franchiseId, e]));
    const posRet = new Map(posReturnAgg.map((e) => [e.franchiseId, e]));

    type Row = {
      franchiseId: string;
      franchiseName: string;
      totalOnlineOrders: number;
      totalProcurements: number;
      totalRevenue: Prisma.Decimal;
      platformEarning: Prisma.Decimal;
    };
    const rows: Row[] = [];
    for (const id of nameById.keys()) {
      const o = online.get(id);
      const pr = proc.get(id);
      const ps = pos.get(id);
      const prt = posRet.get(id);
      // No activity of ANY kind in the window → not a "performer" this period.
      if (!o && !pr && !ps) continue;
      const onlineBase = dec(o?._sum.baseAmount);
      const posNet = dec(ps?._sum.netAmount).minus(dec(prt?._sum.refundAmount));
      const totalRevenue = onlineBase.plus(posNet);
      const platformEarning = dec(o?._sum.platformEarning).plus(dec(pr?._sum.platformEarning));
      rows.push({
        franchiseId: id,
        franchiseName: nameById.get(id) || 'Unknown',
        totalOnlineOrders: o?._count.id ?? 0,
        totalProcurements: pr?._count.id ?? 0,
        totalRevenue,
        platformEarning,
      });
    }

    // #1 rank by metric; #11 deterministic tie-break on franchiseId.
    rows.sort((a, b) => {
      const av = metric === 'MARGIN' ? a.platformEarning : a.totalRevenue;
      const bv = metric === 'MARGIN' ? b.platformEarning : b.totalRevenue;
      const cmp = bv.comparedTo(av);
      return cmp !== 0 ? cmp : a.franchiseId.localeCompare(b.franchiseId);
    });

    return rows.slice(offset, offset + limit).map((r, i) => ({
      rank: offset + i + 1, // #11
      franchiseId: r.franchiseId,
      franchiseName: r.franchiseName,
      totalOnlineOrders: r.totalOnlineOrders,
      totalProcurements: r.totalProcurements,
      totalRevenue: r.totalRevenue.toFixed(2),
      platformEarning: r.platformEarning.toFixed(2),
      // #15 — franchises now carry marginPercentage too (was seller-only).
      marginPercentage: r.totalRevenue.gt(0)
        ? r.platformEarning.div(r.totalRevenue).times(100).toDecimalPlaces(2).toNumber()
        : 0,
    }));
  }

  // ── Outstanding payables ───────────────────────────────────

  async getOutstandingPayables(asOfDate?: Date) {
    // Phase 178 — aging-bucketed, NET-of-deductions outstanding payables.
    //   #3  net payable = gross − TCS − TDS − commission-GST − already-paid.
    //   #1/#2/#9  aging vs the due anchor COALESCE(payout_due_by, created_at+7d).
    //   #4  frozen (frozen_at) / ON_HOLD excluded from overdue; surfaced apart.
    //   #7  money as exact paise→rupee strings.
    const asOf = asOfDate ?? new Date();
    // Outstanding = unpaid, not-frozen states.
    // Outstanding = unpaid, not-frozen states. The two settlement enums DIFFER:
    // SellerSettlementStatus has READY_FOR_PAYOUT (batched, awaiting bank run),
    // but FranchiseSettlementStatus does NOT. Casting 'READY_FOR_PAYOUT' against
    // franchise_settlements.status threw 22P02 ("invalid input value for enum
    // FranchiseSettlementStatus") — the 500 on this endpoint. So use a per-enum
    // list: only the seller branch includes READY_FOR_PAYOUT.
    // Outstanding = unpaid, not-frozen states. NOTE: SellerSettlementStatus
    // has READY_FOR_PAYOUT but FranchiseSettlementStatus does NOT — sharing a
    // single list cast READY_FOR_PAYOUT against the franchise enum and 500'd
    // with Postgres 22P02 (invalid enum input). Keep the two lists separate.
    const SELLER_OUTSTANDING = Prisma.sql`('PENDING','APPROVED','READY_FOR_PAYOUT','FAILED','PARTIALLY_PAID')`;
    const FRANCHISE_OUTSTANDING = Prisma.sql`('PENDING','APPROVED','FAILED','PARTIALLY_PAID')`;
    const SELLER_NET = Prisma.sql`(total_settlement_amount_in_paise - tcs_deducted_in_paise - tds_deducted_in_paise - total_commission_gst_in_paise - paid_amount_in_paise)`;
    const FRANCHISE_NET = Prisma.sql`((net_payable_to_franchise * 100)::bigint - paid_amount_in_paise)`;

    const bucketExpr = (anchor: Prisma.Sql) => Prisma.sql`
      CASE
        WHEN ${asOf}::timestamptz - ${anchor} < INTERVAL '0 days'  THEN 'not_due'
        WHEN ${asOf}::timestamptz - ${anchor} <= INTERVAL '7 days'  THEN '0-7'
        WHEN ${asOf}::timestamptz - ${anchor} <= INTERVAL '15 days' THEN '8-15'
        WHEN ${asOf}::timestamptz - ${anchor} <= INTERVAL '30 days' THEN '16-30'
        ELSE '30+'
      END`;

    const sellerAnchor = Prisma.sql`COALESCE(payout_due_by, created_at + INTERVAL '7 days')`;
    const franchiseAnchor = Prisma.sql`COALESCE(payout_due_by, created_at + INTERVAL '7 days')`;

    const [sellerRows, franchiseRows, sellerFrozen, franchiseFrozen, sellerFailed, franchiseFailed, oldestRow] =
      await Promise.all([
        this.prisma.$queryRaw<Array<{ bucket: string; cnt: bigint; net_paise: bigint }>>(Prisma.sql`
          SELECT ${bucketExpr(sellerAnchor)} AS bucket, COUNT(*)::bigint AS cnt,
                 COALESCE(SUM(${SELLER_NET}), 0)::bigint AS net_paise
          FROM seller_settlements
          WHERE status IN ${SELLER_OUTSTANDING} AND frozen_at IS NULL AND ${SELLER_NET} > 0
          GROUP BY 1`),
        this.prisma.$queryRaw<Array<{ bucket: string; cnt: bigint; net_paise: bigint }>>(Prisma.sql`
          SELECT ${bucketExpr(franchiseAnchor)} AS bucket, COUNT(*)::bigint AS cnt,
                 COALESCE(SUM(${FRANCHISE_NET}), 0)::bigint AS net_paise
          FROM franchise_settlements
          WHERE status IN ${FRANCHISE_OUTSTANDING} AND frozen_at IS NULL AND ${FRANCHISE_NET} > 0
          GROUP BY 1`),
        this.prisma.sellerSettlement.count({ where: { frozenAt: { not: null } } }),
        this.prisma.franchiseSettlement.count({ where: { frozenAt: { not: null } } }),
        this.prisma.sellerSettlement.count({ where: { status: 'FAILED' } }),
        this.prisma.franchiseSettlement.count({ where: { status: 'FAILED' } }),
        this.prisma.$queryRaw<Array<{ oldest: Date | null }>>(Prisma.sql`
          SELECT MIN(anchor) AS oldest FROM (
            SELECT ${sellerAnchor} AS anchor FROM seller_settlements
              WHERE status IN ${SELLER_OUTSTANDING} AND frozen_at IS NULL AND ${SELLER_NET} > 0
                AND ${sellerAnchor} < ${asOf}::timestamptz
            UNION ALL
            SELECT ${franchiseAnchor} AS anchor FROM franchise_settlements
              WHERE status IN ${FRANCHISE_OUTSTANDING} AND frozen_at IS NULL AND ${FRANCHISE_NET} > 0
                AND ${franchiseAnchor} < ${asOf}::timestamptz
          ) u`),
      ]);

    const SEVERITY: Record<string, string | null> = {
      not_due: null, '0-7': 'LOW', '8-15': 'MEDIUM', '16-30': 'HIGH', '30+': 'CRITICAL',
    };
    const ORDER = ['not_due', '0-7', '8-15', '16-30', '30+'];

    // Merge seller+franchise rows per bucket.
    const merged = new Map<string, { count: number; paise: bigint }>();
    let sellerCount = 0, sellerPaise = 0n, franchiseCount = 0, franchisePaise = 0n;
    for (const r of sellerRows) {
      const m = merged.get(r.bucket) ?? { count: 0, paise: 0n };
      m.count += Number(r.cnt); m.paise += BigInt(r.net_paise); merged.set(r.bucket, m);
      sellerCount += Number(r.cnt); sellerPaise += BigInt(r.net_paise);
    }
    for (const r of franchiseRows) {
      const m = merged.get(r.bucket) ?? { count: 0, paise: 0n };
      m.count += Number(r.cnt); m.paise += BigInt(r.net_paise); merged.set(r.bucket, m);
      franchiseCount += Number(r.cnt); franchisePaise += BigInt(r.net_paise);
    }

    const buckets = ORDER.map((key) => {
      const m = merged.get(key) ?? { count: 0, paise: 0n };
      return { bucket: key, severity: SEVERITY[key] ?? null, count: m.count, amount: paiseToRupees(m.paise) };
    });
    let overdueCount = 0, overduePaise = 0n;
    for (const b of buckets) {
      if (b.bucket !== 'not_due') { overdueCount += b.count; overduePaise += merged.get(b.bucket)?.paise ?? 0n; }
    }

    const totalPaise = sellerPaise + franchisePaise;

    return {
      currency: 'INR',
      // Legacy fields (now NET of deductions, #3).
      sellerOutstanding: { count: sellerCount, amount: paiseToRupees(sellerPaise) },
      franchiseOutstanding: { count: franchiseCount, amount: paiseToRupees(franchisePaise) },
      totalOutstanding: paiseToRupees(totalPaise),
      // #9 — oldest OVERDUE due-date (not the oldest createdAt of any unpaid row).
      oldestUnpaidDate: oldestRow[0]?.oldest ?? null,
      // #2/#16 — aging buckets with severity.
      aging: {
        buckets,
        overdue: { count: overdueCount, amount: paiseToRupees(overduePaise) },
      },
      // #4 — frozen + failed, surfaced separately from overdue.
      frozen: { count: sellerFrozen + franchiseFrozen },
      failed: { count: sellerFailed + franchiseFailed },
    };
  }

  /**
   * Phase 178 (#4/#11) — freeze (ON_HOLD) or release a settlement. A frozen
   * settlement is excluded from the overdue/aging buckets until released. Cannot
   * freeze a PAID/CANCELLED settlement. This is the manual mechanism; a
   * TDS-deposit-failure cron can call it with holdReason='TDS_DEPOSIT_PENDING'.
   */
  async setSettlementHold(args: {
    nodeType: 'SELLER' | 'FRANCHISE';
    settlementId: string;
    hold: boolean;
    holdReason?: string | null;
    adminId?: string;
  }) {
    const now = new Date();
    const holdData = args.hold
      ? { status: 'ON_HOLD' as const, frozenAt: now, frozenByAdminId: args.adminId ?? null, holdReason: args.holdReason ?? 'Manual hold' }
      : { status: 'PENDING' as const, frozenAt: null, frozenByAdminId: null, holdReason: null };

    if (args.nodeType === 'SELLER') {
      const s = await this.prisma.sellerSettlement.findUnique({
        where: { id: args.settlementId }, select: { status: true },
      });
      if (!s) throw new NotFoundAppException('Settlement not found');
      if (args.hold && (s.status === 'PAID' || s.status === 'CANCELLED')) {
        throw new ConflictAppException(`Cannot freeze a ${s.status} settlement.`);
      }
      return this.prisma.sellerSettlement.update({
        where: { id: args.settlementId },
        data: holdData,
        select: { id: true, status: true, frozenAt: true },
      });
    }

    const f = await this.prisma.franchiseSettlement.findUnique({
      where: { id: args.settlementId }, select: { status: true },
    });
    if (!f) throw new NotFoundAppException('Settlement not found');
    if (args.hold && f.status === 'PAID') {
      throw new ConflictAppException('Cannot freeze a PAID settlement.');
    }
    return this.prisma.franchiseSettlement.update({
      where: { id: args.settlementId },
      data: holdData,
      select: { id: true, status: true, frozenAt: true },
    });
  }

  /**
   * Phase 178 (#12) — record a (partial or full) bank disbursement against a
   * settlement. Increments paidAmountInPaise; flips to PAID when the cumulative
   * paid reaches the NET payable (#3 net), else PARTIALLY_PAID. Rejects paying a
   * PAID/CANCELLED/ON_HOLD settlement or over-paying. CAS-guarded + atomic.
   */
  async recordSettlementPayment(args: {
    nodeType: 'SELLER' | 'FRANCHISE';
    settlementId: string;
    amountInPaise: bigint;
    adminId?: string;
  }) {
    if (args.amountInPaise <= 0n) {
      throw new ConflictAppException('Payment amount must be positive.');
    }
    return this.prisma.$transaction(async (tx) => {
      if (args.nodeType === 'SELLER') {
        const s = await tx.sellerSettlement.findUnique({
          where: { id: args.settlementId },
          select: {
            status: true, paidAmountInPaise: true,
            totalSettlementAmountInPaise: true, tcsDeductedInPaise: true,
            tdsDeductedInPaise: true, totalCommissionGstInPaise: true,
          },
        });
        if (!s) throw new NotFoundAppException('Settlement not found');
        if (['PAID', 'CANCELLED', 'ON_HOLD'].includes(s.status)) {
          throw new ConflictAppException(`Cannot record a payment against a ${s.status} settlement.`);
        }
        const net = s.totalSettlementAmountInPaise - s.tcsDeductedInPaise - s.tdsDeductedInPaise - s.totalCommissionGstInPaise;
        const newPaid = s.paidAmountInPaise + args.amountInPaise;
        if (newPaid > net) {
          throw new ConflictAppException('Payment exceeds the net payable.');
        }
        const status = newPaid >= net ? ('PAID' as const) : ('PARTIALLY_PAID' as const);
        const cas = await tx.sellerSettlement.updateMany({
          where: { id: args.settlementId, status: s.status },
          data: { paidAmountInPaise: newPaid, status, paidAt: status === 'PAID' ? new Date() : undefined },
        });
        if (cas.count !== 1) throw new ConflictAppException('Settlement changed during payment — retry.');
        return { id: args.settlementId, status, paidAmountInPaise: newPaid.toString() };
      }

      const f = await tx.franchiseSettlement.findUnique({
        where: { id: args.settlementId },
        select: { status: true, paidAmountInPaise: true, netPayableToFranchise: true },
      });
      if (!f) throw new NotFoundAppException('Settlement not found');
      if (['PAID', 'CANCELLED', 'ON_HOLD'].includes(f.status)) {
        throw new ConflictAppException(`Cannot record a payment against a ${f.status} settlement.`);
      }
      const net = BigInt(dec(f.netPayableToFranchise).times(100).toFixed(0));
      const newPaid = f.paidAmountInPaise + args.amountInPaise;
      if (newPaid > net) {
        throw new ConflictAppException('Payment exceeds the net payable.');
      }
      const status = newPaid >= net ? ('PAID' as const) : ('PARTIALLY_PAID' as const);
      const cas = await tx.franchiseSettlement.updateMany({
        where: { id: args.settlementId, status: f.status },
        data: { paidAmountInPaise: newPaid, status, paidAt: status === 'PAID' ? new Date() : undefined },
      });
      if (cas.count !== 1) throw new ConflictAppException('Settlement changed during payment — retry.');
      return { id: args.settlementId, status, paidAmountInPaise: newPaid.toString() };
    });
  }

  // ── Phase 176: per-seller accounts drill-down ──────────────────

  /**
   * Phase 176 (#1/#6/#7/#8/#9/#10) — one bundle for a single seller's financial
   * picture: revenue/margin (net of refunds), commission status breakdown,
   * payable (pending vs paid, date-consistent #7), TDS + TCS deducted (#8),
   * reversals/adjustments (#9), and reconciliation-discrepancy counts (#10, via
   * the order→commission join). Money is exact strings (#175 #3). Returns null
   * for a missing/deleted seller so the service can 404 (#13).
   */
  async getSellerAccountsOverview(sellerId: string, fromDate?: Date, toDate?: Date) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, sellerName: true, gstin: true, panNumber: true, status: true, isDeleted: true },
    });
    if (!seller || seller.isDeleted) return null;

    const created = dateRange('createdAt', fromDate, toDate);
    const paid = dateRange('paidAt', fromDate, toDate);
    const computed = dateRange('computedAt', fromDate, toDate);
    const now = new Date(); // #18 — overdue cutoff (as-of now, independent of window)

    const [
      commissionAgg,
      statusBreakdown,
      pendingSettleAgg,
      paidSettleAgg,
      lastPaid,
      tdsAgg,
      tdsDepositedCount,
      tcsAgg,
      adjustmentsAgg,
      reversalAgg,
      reconRows,
      overdueSettleAgg,
    ] = await Promise.all([
      this.prisma.commissionRecord.aggregate({
        where: { sellerId, ...created },
        _sum: {
          totalPlatformAmount: true,
          platformMargin: true,
          totalSettlementAmount: true,
          refundedAdminEarning: true,
          taxCommission: true,
          vatOnCommission: true,
        },
        _count: { id: true },
      }),
      this.prisma.commissionRecord.groupBy({
        by: ['status'],
        where: { sellerId, ...created },
        _count: { id: true },
        _sum: { totalPlatformAmount: true },
      }),
      // #7 — pending payable scoped to settlements CREATED in the window.
      this.prisma.sellerSettlement.aggregate({
        where: { sellerId, status: { in: ['PENDING', 'APPROVED'] }, ...created },
        _count: { id: true },
        _sum: { totalSettlementAmount: true },
      }),
      // #7 — settled scoped to settlements PAID in the window.
      this.prisma.sellerSettlement.aggregate({
        where: { sellerId, status: 'PAID', ...paid },
        _count: { id: true },
        _sum: { totalSettlementAmount: true },
      }),
      this.prisma.sellerSettlement.findFirst({
        where: { sellerId, status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        select: { paidAt: true },
      }),
      // #8 — §194-O TDS deducted for the seller in the window.
      this.prisma.section194OTdsLedger.aggregate({
        where: { sellerId, status: { not: 'REVERSED' }, ...computed },
        _sum: { tdsInPaise: true },
        _count: { id: true },
      }),
      this.prisma.section194OTdsLedger.count({
        where: { sellerId, status: 'DEPOSITED', ...computed },
      }),
      // #8 — §52 TCS collected for the seller in the window.
      this.prisma.gstTcsSettlementLedger.aggregate({
        where: { sellerId, status: { not: 'REVERSED' }, ...computed },
        _sum: { totalTcsInPaise: true },
        _count: { id: true },
      }),
      // #9 — active settlement adjustments for the seller (point-in-time).
      this.prisma.settlementAdjustment.aggregate({
        where: { settlement: { sellerId }, status: 'ACTIVE' },
        _sum: { amount: true },
        _count: { id: true },
      }),
      // #9 — commission reversals = REFUNDED records + their refunded earning.
      this.prisma.commissionRecord.aggregate({
        where: { sellerId, status: 'REFUNDED', ...created },
        _sum: { refundedAdminEarning: true },
        _count: { id: true },
      }),
      // #10/#13 — discrepancies attributable to this seller: ORDER-level (a
      // commission record carries the order id) OR SETTLEMENT-level (a
      // settlement discrepancy's externalRef = the seller settlement id, which
      // the recon SETTLEMENT runner emits for MISSING_UTR / stuck settlements).
      // DISTINCT so one discrepancy counts once.
      this.prisma.$queryRaw<Array<{ status: string; cnt: bigint }>>(Prisma.sql`
        SELECT d.status AS status, COUNT(DISTINCT d.id)::bigint AS cnt
        FROM reconciliation_discrepancies d
        WHERE d.master_order_id IN (
                SELECT DISTINCT master_order_id FROM commission_records WHERE seller_id = ${sellerId}
              )
           OR d.external_ref IN (
                SELECT id FROM seller_settlements WHERE seller_id = ${sellerId}
              )
        GROUP BY d.status
      `),
      // Phase 178 (#18) — the seller's OWN overdue exposure: unpaid settlements
      // past their payout SLA (frozen excluded). Gross basis, consistent with
      // payable.pendingAmount in this same bundle.
      this.prisma.sellerSettlement.aggregate({
        where: {
          sellerId,
          status: { in: ['PENDING', 'APPROVED', 'READY_FOR_PAYOUT', 'FAILED', 'PARTIALLY_PAID'] },
          frozenAt: null,
          payoutDueBy: { lt: now },
        },
        _count: { id: true },
        _sum: { totalSettlementAmount: true },
      }),
    ]);

    const grossRevenue = dec(commissionAgg._sum.totalPlatformAmount);
    const refunded = dec(commissionAgg._sum.refundedAdminEarning);
    const taxOnCommission = dec(commissionAgg._sum.taxCommission).plus(
      dec(commissionAgg._sum.vatOnCommission),
    );

    const breakdown = { PENDING: 0, ON_HOLD: 0, SETTLED: 0, REFUNDED: 0 } as Record<string, number>;
    for (const b of statusBreakdown) breakdown[b.status] = b._count.id;

    let openDiscrepancies = 0;
    let resolvedDiscrepancies = 0;
    for (const r of reconRows) {
      const n = Number(r.cnt);
      if (r.status === 'OPEN' || r.status === 'IN_REVIEW') openDiscrepancies += n;
      else resolvedDiscrepancies += n;
    }

    return {
      currency: 'INR',
      seller: {
        id: seller.id,
        name: seller.sellerName,
        gstin: seller.gstin,
        pan: maskPan(seller.panNumber), // PII — masked
        status: seller.status,
      },
      period: {
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
      },
      revenue: {
        gross: money(commissionAgg._sum.totalPlatformAmount),
        refundsDeducted: money(commissionAgg._sum.refundedAdminEarning),
        net: grossRevenue.minus(refunded).toFixed(2),
        taxExcluded: taxOnCommission.toFixed(2), // shown separately, not in revenue
      },
      margin: {
        platformMargin: money(commissionAgg._sum.platformMargin),
        marginPercentage: grossRevenue.gt(0)
          ? dec(commissionAgg._sum.platformMargin).div(grossRevenue).times(100).toDecimalPlaces(2).toNumber()
          : 0,
      },
      commission: {
        recordCount: commissionAgg._count.id,
        statusBreakdown: breakdown,
        totalSettlementAmount: money(commissionAgg._sum.totalSettlementAmount),
      },
      payable: {
        pendingCount: pendingSettleAgg._count.id,
        pendingAmount: money(pendingSettleAgg._sum.totalSettlementAmount),
        paidCount: paidSettleAgg._count.id,
        paidAmount: money(paidSettleAgg._sum.totalSettlementAmount),
        lastSettledOn: lastPaid?.paidAt ? lastPaid.paidAt.toISOString() : null,
      },
      // Phase 178 (#18) — overdue indicator for the self-view.
      overdue: {
        count: overdueSettleAgg._count.id,
        amount: money(overdueSettleAgg._sum.totalSettlementAmount),
      },
      taxDeductions: {
        tdsDeducted: paiseToRupees(tdsAgg._sum.tdsInPaise),
        tdsRowCount: tdsAgg._count.id,
        tdsDepositedCount,
        tcsCollected: paiseToRupees(tcsAgg._sum.totalTcsInPaise),
        tcsRowCount: tcsAgg._count.id,
        note: 'Statutory deductions shown for transparency; the settlement net already accounts for amounts withheld.',
      },
      adjustments: {
        count: adjustmentsAgg._count.id,
        totalAmount: money(adjustmentsAgg._sum.amount),
      },
      reversals: {
        count: reversalAgg._count.id,
        refundedAdminEarning: money(reversalAgg._sum.refundedAdminEarning),
      },
      reconciliation: {
        openDiscrepancies,
        resolvedDiscrepancies,
      },
      linkSources: {
        settlementsUrl: `/dashboard/finance/settlements?nodeType=SELLER&search=${encodeURIComponent(seller.sellerName)}`,
        commissionUrl: `/dashboard/commission?sellerId=${seller.id}`,
        tdsUrl: '/dashboard/tax/tds194o',
        tcsUrl: '/dashboard/tax/tcs',
      },
    };
  }

  /** Phase 176 (#11) — paginated commission records for a seller. */
  async getSellerCommissionRecords(
    sellerId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ) {
    const where = { sellerId, ...dateRange('createdAt', fromDate, toDate) };
    const [rows, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, orderNumber: true, productTitle: true, status: true,
          totalPlatformAmount: true, platformMargin: true, createdAt: true,
        },
      }),
      this.prisma.commissionRecord.count({ where }),
    ]);
    return {
      total,
      page,
      limit,
      records: rows.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        productTitle: r.productTitle,
        status: r.status,
        totalPlatformAmount: money(r.totalPlatformAmount),
        platformMargin: money(r.platformMargin),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Phase 176 (#11) — paginated settlement cycles for a seller. */
  async getSellerSettlements(
    sellerId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ) {
    const where = { sellerId, ...dateRange('createdAt', fromDate, toDate) };
    const [rows, total] = await Promise.all([
      this.prisma.sellerSettlement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, cycleId: true, status: true, totalSettlementAmount: true,
          totalPlatformMargin: true, utrReference: true, paidAt: true, createdAt: true,
          // Phase 178 (#15) — payout/UTR drill-down: surface the failure reason
          // (why a FAILED disbursement bounced) and the SLA due date.
          paymentFailureReason: true, payoutDueBy: true,
        },
      }),
      this.prisma.sellerSettlement.count({ where }),
    ]);
    return {
      total,
      page,
      limit,
      settlements: rows.map((s) => ({
        id: s.id,
        cycleId: s.cycleId,
        status: s.status,
        totalSettlementAmount: money(s.totalSettlementAmount),
        totalPlatformMargin: money(s.totalPlatformMargin),
        utrReference: s.utrReference,
        paymentFailureReason: s.paymentFailureReason,
        payoutDueBy: s.payoutDueBy ? s.payoutDueBy.toISOString() : null,
        paidAt: s.paidAt ? s.paidAt.toISOString() : null,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  // ── Phase 177: per-franchise accounts drill-down ───────────────

  /**
   * Phase 177 (#1/#5/#6/#12/#13/#14) — one bundle for a single franchise's
   * financial picture: ONLINE revenue (finance-ledger) + POS revenue
   * (franchisePosSale, net of voids #14 and returns), procurement cost basis
   * (#6, PROCUREMENT_FEE ledger), platform margin, payable (pending vs paid,
   * date-consistent #12), reversals, and reconciliation-discrepancy counts
   * (#13, via the order→ledger join). Money is exact strings (#8). Returns null
   * for a missing/deleted franchise so the service can 404.
   */
  async getFranchiseAccountsOverview(franchiseId: string, fromDate?: Date, toDate?: Date) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true, franchiseCode: true, businessName: true,
        gstNumber: true, panNumber: true, status: true, isDeleted: true,
        warehousePincode: true,
      },
    });
    if (!franchise || franchise.isDeleted) return null;

    const created = dateRange('createdAt', fromDate, toDate);
    const paid = dateRange('paidAt', fromDate, toDate);
    const sold = dateRange('soldAt', fromDate, toDate);
    const returned = dateRange('returnedAt', fromDate, toDate);
    const now = new Date(); // #18 — overdue cutoff

    const [
      onlineAgg,
      procurementAgg,
      reversalAgg,
      posAgg,
      posVoidCount,
      posReturnAgg,
      pendingSettleAgg,
      paidSettleAgg,
      lastPaid,
      adjustmentsAgg,
      reconRows,
      overdueSettleAgg,
    ] = await Promise.all([
      this.prisma.franchiseFinanceLedger.aggregate({
        where: { franchiseId, sourceType: 'ONLINE_ORDER', status: { not: 'REVERSED' }, ...created },
        _sum: { baseAmount: true, platformEarning: true, franchiseEarning: true },
        _count: { id: true },
      }),
      this.prisma.franchiseFinanceLedger.aggregate({
        where: { franchiseId, sourceType: 'PROCUREMENT_FEE', status: { not: 'REVERSED' }, ...created },
        _sum: { baseAmount: true, platformEarning: true },
        _count: { id: true },
      }),
      // #6.6 — reversed-this-period KPI (excluded from active aggregates).
      this.prisma.franchiseFinanceLedger.aggregate({
        where: { franchiseId, status: 'REVERSED', ...created },
        _sum: { baseAmount: true, platformEarning: true },
        _count: { id: true },
      }),
      // #5 — POS revenue, ACTIVE sales only (voidedAt null nets out voids, #14).
      this.prisma.franchisePosSale.aggregate({
        where: { franchiseId, voidedAt: null, ...sold },
        _sum: { netAmount: true, grossAmount: true },
        _count: { id: true },
      }),
      this.prisma.franchisePosSale.count({
        where: { franchiseId, voidedAt: { not: null }, ...sold },
      }),
      // #14 — POS returns reduce POS revenue.
      this.prisma.franchisePosReturn.aggregate({
        where: { franchiseId, ...returned },
        _sum: { refundAmount: true },
        _count: { id: true },
      }),
      // #12 — pending payable scoped to createdAt, settled to paidAt.
      this.prisma.franchiseSettlement.aggregate({
        where: { franchiseId, status: 'PENDING', ...created },
        _count: { id: true },
        _sum: { netPayableToFranchise: true },
      }),
      this.prisma.franchiseSettlement.aggregate({
        where: { franchiseId, status: 'PAID', ...paid },
        _count: { id: true },
        _sum: { netPayableToFranchise: true },
      }),
      this.prisma.franchiseSettlement.findFirst({
        where: { franchiseId, status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        select: { paidAt: true },
      }),
      // #4 — itemized active settlement adjustments for this franchise.
      this.prisma.franchiseSettlementAdjustment.aggregate({
        where: { franchiseId, status: 'ACTIVE', ...created },
        _sum: { amount: true },
        _count: { id: true },
      }),
      // #13 — discrepancies attributable to this franchise: ORDER-level (an
      // ONLINE_ORDER ledger row carries the order id) OR SETTLEMENT-level (a
      // settlement discrepancy's externalRef = the franchise settlement id).
      this.prisma.$queryRaw<Array<{ status: string; cnt: bigint }>>(Prisma.sql`
        SELECT d.status AS status, COUNT(DISTINCT d.id)::bigint AS cnt
        FROM reconciliation_discrepancies d
        WHERE d.master_order_id IN (
                SELECT DISTINCT source_id FROM franchise_finance_ledger
                WHERE franchise_id = ${franchiseId} AND source_type = 'ONLINE_ORDER'
              )
           OR d.external_ref IN (
                SELECT id FROM franchise_settlements WHERE franchise_id = ${franchiseId}
              )
        GROUP BY d.status
      `),
      // Phase 178 (#18) — the franchise's OWN overdue exposure: unpaid
      // settlements past their payout SLA (frozen excluded).
      this.prisma.franchiseSettlement.aggregate({
        where: {
          franchiseId,
          status: { in: ['PENDING', 'APPROVED', 'FAILED', 'PARTIALLY_PAID'] },
          frozenAt: null,
          payoutDueBy: { lt: now },
        },
        _count: { id: true },
        _sum: { netPayableToFranchise: true },
      }),
    ]);

    const onlineRevenue = dec(onlineAgg._sum.baseAmount);
    const posGross = dec(posAgg._sum.netAmount);
    const posReturns = dec(posReturnAgg._sum.refundAmount);
    const posNet = posGross.minus(posReturns);
    const totalRevenue = onlineRevenue.plus(posNet);
    const platformMargin = dec(onlineAgg._sum.platformEarning).plus(
      dec(procurementAgg._sum.platformEarning),
    );

    let openDiscrepancies = 0;
    let resolvedDiscrepancies = 0;
    for (const r of reconRows) {
      const n = Number(r.cnt);
      if (r.status === 'OPEN' || r.status === 'IN_REVIEW') openDiscrepancies += n;
      else resolvedDiscrepancies += n;
    }

    return {
      currency: 'INR',
      franchise: {
        id: franchise.id,
        code: franchise.franchiseCode,
        name: franchise.businessName,
        gstin: franchise.gstNumber,
        pan: maskPan(franchise.panNumber),
        status: franchise.status,
        warehousePincode: franchise.warehousePincode,
      },
      period: {
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
      },
      revenue: {
        onlineRevenue: onlineRevenue.toFixed(2),
        posGross: posGross.toFixed(2),
        posReturns: posReturns.toFixed(2),
        posNet: posNet.toFixed(2),
        totalRevenue: totalRevenue.toFixed(2),
      },
      procurement: {
        totalProcuredValue: money(procurementAgg._sum.baseAmount), // #6 cost basis
        procurementFees: money(procurementAgg._sum.platformEarning),
        procurementCount: procurementAgg._count.id,
        note: 'Cost basis = value charged on PROCUREMENT_FEE ledger rows; per-item unit-cost snapshots live on the procurement requests.',
      },
      platformMargin: {
        online: money(onlineAgg._sum.platformEarning),
        procurement: money(procurementAgg._sum.platformEarning),
        total: platformMargin.toFixed(2),
      },
      pos: {
        saleCount: posAgg._count.id,
        voidedCount: posVoidCount,
        returnCount: posReturnAgg._count.id,
      },
      payable: {
        pendingCount: pendingSettleAgg._count.id,
        pendingAmount: money(pendingSettleAgg._sum.netPayableToFranchise),
        paidCount: paidSettleAgg._count.id,
        paidAmount: money(paidSettleAgg._sum.netPayableToFranchise),
        lastSettledOn: lastPaid?.paidAt ? lastPaid.paidAt.toISOString() : null,
      },
      // Phase 178 (#18) — overdue indicator for the self-view.
      overdue: {
        count: overdueSettleAgg._count.id,
        amount: money(overdueSettleAgg._sum.netPayableToFranchise),
      },
      reversals: {
        count: reversalAgg._count.id,
        baseAmount: money(reversalAgg._sum.baseAmount),
        platformEarning: money(reversalAgg._sum.platformEarning),
      },
      adjustments: {
        count: adjustmentsAgg._count.id,
        totalAmount: money(adjustmentsAgg._sum.amount),
      },
      reconciliation: { openDiscrepancies, resolvedDiscrepancies },
      linkSources: {
        ledgerCsvUrl: `/admin/accounts/settlements/franchise-ledger/export?franchiseId=${franchise.id}`,
        settlementsUrl: `/dashboard/finance/settlements?nodeType=FRANCHISE&search=${encodeURIComponent(franchise.businessName)}`,
      },
    };
  }

  /**
   * Phase 177 (#10) — paginated finance-ledger rows. Optional `sourceType`
   * (ONLINE_ORDER = "orders", PROCUREMENT_FEE = "procurements") and `status`
   * (REVERSED = "reversals") filters give the audit's per-stream drill-downs off
   * one endpoint.
   */
  async getFranchiseLedgerEntries(
    franchiseId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
    sourceType?: string,
    status?: string,
  ) {
    const where: Prisma.FranchiseFinanceLedgerWhereInput = {
      franchiseId,
      ...dateRange('createdAt', fromDate, toDate),
      ...(sourceType ? { sourceType: sourceType as any } : {}),
      ...(status ? { status: status as any } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.franchiseFinanceLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, sourceType: true, sourceId: true, status: true,
          baseAmount: true, platformEarning: true, franchiseEarning: true, createdAt: true,
        },
      }),
      this.prisma.franchiseFinanceLedger.count({ where }),
    ]);
    return {
      total, page, limit,
      entries: rows.map((r) => ({
        id: r.id,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        status: r.status,
        baseAmount: money(r.baseAmount),
        platformEarning: money(r.platformEarning),
        franchiseEarning: money(r.franchiseEarning),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Phase 177 (#10) — paginated POS sales for a franchise. */
  async getFranchisePosSales(
    franchiseId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ) {
    const where = { franchiseId, ...dateRange('soldAt', fromDate, toDate) };
    const [rows, total] = await Promise.all([
      this.prisma.franchisePosSale.findMany({
        where,
        orderBy: { soldAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, saleType: true, status: true, grossAmount: true,
          netAmount: true, voidedAt: true, soldAt: true,
        },
      }),
      this.prisma.franchisePosSale.count({ where }),
    ]);
    return {
      total, page, limit,
      sales: rows.map((s) => ({
        id: s.id,
        saleType: s.saleType,
        status: s.status,
        grossAmount: money(s.grossAmount),
        netAmount: money(s.netAmount),
        voided: s.voidedAt != null,
        soldAt: s.soldAt.toISOString(),
      })),
    };
  }

  /** Phase 177 (#10) — paginated settlement cycles for a franchise. */
  async getFranchiseSettlementsList(
    franchiseId: string,
    fromDate: Date | undefined,
    toDate: Date | undefined,
    page: number,
    limit: number,
  ) {
    const where = { franchiseId, ...dateRange('createdAt', fromDate, toDate) };
    const [rows, total] = await Promise.all([
      this.prisma.franchiseSettlement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, cycleId: true, status: true, netPayableToFranchise: true,
          totalPlatformEarning: true, paidAt: true, createdAt: true,
          // Phase 178 (#15) — payout drill-down: bank/UPI reference + SLA due date.
          paymentReference: true, payoutDueBy: true,
          // Phase 251 — dynamic charge rules: total + flag + frozen rule-wise
          // breakup so the admin franchise tab can itemize the deductions + net.
          // Legacy statutory columns are needed to compute the net of older
          // (non-rule) cycles via the shared settlement-net helper.
          dynamicChargeTotalInPaise: true, chargeRulesApplied: true,
          tcsDeductedInPaise: true, tdsDeductedInPaise: true,
          totalCommissionGstInPaise: true,
          chargeLines: {
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true, ruleName: true, baseType: true, rateBps: true,
              baseAmountInPaise: true, amountInPaise: true,
            },
          },
        },
      }),
      this.prisma.franchiseSettlement.count({ where }),
    ]);
    return {
      total, page, limit,
      settlements: rows.map((s) => ({
        id: s.id,
        cycleId: s.cycleId,
        status: s.status,
        netPayableToFranchise: money(s.netPayableToFranchise),
        totalPlatformEarning: money(s.totalPlatformEarning),
        paymentReference: s.paymentReference,
        payoutDueBy: s.payoutDueBy ? s.payoutDueBy.toISOString() : null,
        paidAt: s.paidAt ? s.paidAt.toISOString() : null,
        createdAt: s.createdAt.toISOString(),
        // Phase 251 — paise BigInt → string on the wire (codebase convention).
        dynamicChargeTotalInPaise: s.dynamicChargeTotalInPaise.toString(),
        chargeRulesApplied: s.chargeRulesApplied,
        // Single source of truth net (paise string) — gross (netPayableToFranchise)
        // minus the dynamic total or the legacy statutory trio.
        netPayableInPaise: settlementNetFromRow(
          s,
          BigInt(new Prisma.Decimal(s.netPayableToFranchise).mul(100).toFixed(0)),
        ).toString(),
        chargeLines: s.chargeLines.map((l) => ({
          id: l.id,
          ruleName: l.ruleName,
          baseType: l.baseType,
          rateBps: l.rateBps,
          baseAmountInPaise: l.baseAmountInPaise.toString(),
          amountInPaise: l.amountInPaise.toString(),
        })),
      })),
    };
  }

  /** Phase 177 (#10/#13) — paginated reconciliation discrepancies for a franchise. */
  async getFranchiseReconciliationDiscrepancies(
    franchiseId: string,
    status: string | undefined,
    page: number,
    limit: number,
  ) {
    const idRows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT d.id FROM reconciliation_discrepancies d
      WHERE d.master_order_id IN (
              SELECT DISTINCT source_id FROM franchise_finance_ledger
              WHERE franchise_id = ${franchiseId} AND source_type = 'ONLINE_ORDER'
            )
         OR d.external_ref IN (
              SELECT id FROM franchise_settlements WHERE franchise_id = ${franchiseId}
            )
    `);
    const ids = idRows.map((r) => r.id);
    if (ids.length === 0) return { total: 0, page, limit, discrepancies: [] };

    const where: Prisma.ReconciliationDiscrepancyWhereInput = {
      id: { in: ids },
      ...(status ? { status: status as any } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.reconciliationDiscrepancy.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, kind: true, status: true, severity: true,
          orderNumber: true, externalRef: true, differenceInPaise: true,
          description: true, createdAt: true,
        },
      }),
      this.prisma.reconciliationDiscrepancy.count({ where }),
    ]);
    return {
      total, page, limit,
      discrepancies: rows.map((d) => ({
        id: d.id,
        kind: d.kind,
        status: d.status,
        severity: d.severity,
        orderNumber: d.orderNumber,
        externalRef: d.externalRef,
        difference: paiseToRupees(d.differenceInPaise),
        description: d.description,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Phase 177 (#4) — record an itemized adjustment against a PENDING franchise
   * settlement. Creates the line item AND shifts the settlement's
   * `adjustmentAmount` + `netPayableToFranchise` by the (signed) amount,
   * atomically. Rejects a non-PENDING settlement (a PAID one needs a reversal
   * flow) with a CAS guard so a concurrent mark-paid can't be clobbered.
   */
  async createFranchiseSettlementAdjustment(args: {
    settlementId: string;
    amount: string; // signed rupee string, e.g. "-150.00"
    adjustmentType: SettlementAdjustmentType;
    notes?: string | null;
    adminId?: string;
  }) {
    const amountDec = new Prisma.Decimal(args.amount);
    const amountPaise = BigInt(amountDec.times(100).toFixed(0));
    return this.prisma.$transaction(async (tx) => {
      const settle = await tx.franchiseSettlement.findUnique({
        where: { id: args.settlementId },
        select: { id: true, franchiseId: true, status: true },
      });
      if (!settle) throw new NotFoundAppException('Franchise settlement not found');
      if (settle.status !== 'PENDING') {
        throw new ConflictAppException('Only a PENDING settlement can be adjusted.');
      }
      const adj = await tx.franchiseSettlementAdjustment.create({
        data: {
          settlementId: args.settlementId,
          franchiseId: settle.franchiseId,
          amount: amountDec,
          amountInPaise: amountPaise,
          adjustmentType: args.adjustmentType,
          notes: args.notes ?? null,
          createdByAdminId: args.adminId ?? null,
        },
      });
      const cas = await tx.franchiseSettlement.updateMany({
        where: { id: args.settlementId, status: 'PENDING' },
        data: {
          adjustmentAmount: { increment: amountDec },
          netPayableToFranchise: { increment: amountDec },
        },
      });
      if (cas.count !== 1) {
        throw new ConflictAppException('Settlement changed during adjustment — retry.');
      }
      return adj;
    });
  }
}
