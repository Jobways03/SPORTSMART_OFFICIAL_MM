import { Injectable, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AccountsRepository,
  ACCOUNTS_REPOSITORY,
} from '../../domain/repositories/accounts.repository.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { settlementNetFromRow } from '../../../settlements/domain/settlement-net';

// Phase 180 — money is exact: Decimal kept as Decimal, serialized as a 2-decimal
// rupee STRING at the boundary (never JS Number, #10). Paise BigInt → rupee str.
const ZERO = new Prisma.Decimal(0);
const dec = (d: Prisma.Decimal | null | undefined): Prisma.Decimal => d ?? ZERO;
function paiseToRupees(p: bigint | null | undefined): string {
  const v = p ?? 0n;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export type MarginDateBasis = 'created' | 'settled';
export type ReportNodeType = 'SELLER' | 'FRANCHISE' | 'ALL';

@Injectable()
export class AccountsReportsService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepo: AccountsRepository,
    private readonly prisma: PrismaService,
  ) {}

  // Phase 180 (#16) — a small per-instance TTL cache. These reports run heavy
  // GROUP BY / 11-aggregate passes and change slowly (settlements run daily), so
  // a 120s cache keyed by (method, params) stops an admin hammering refresh from
  // re-aggregating the whole platform every load.
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly TTL_MS = 120_000;
  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as T;
    const value = await fn();
    this.cache.set(key, { value, expiresAt: now + this.TTL_MS });
    if (this.cache.size > 200) {
      for (const [k, v] of this.cache) if (v.expiresAt <= now) this.cache.delete(k);
    }
    return value;
  }
  private k(prefix: string, ...parts: Array<Date | string | number | undefined | null>): string {
    return prefix + ':' + parts.map((p) => (p instanceof Date ? p.getTime() : (p ?? ''))).join('|');
  }

  async getRevenueBreakdown(
    fromDate: Date,
    toDate: Date,
    groupBy: 'day' | 'week' | 'month',
  ) {
    return this.cached(this.k('revenue', fromDate, toDate, groupBy), () =>
      this.accountsRepo.getRevenueBreakdown({ fromDate, toDate, groupBy }),
    );
  }

  async getPlatformMarginReport(
    fromDate: Date,
    toDate: Date,
    opts: { dateBasis?: MarginDateBasis; nodeType?: ReportNodeType; nodeId?: string } = {},
  ) {
    return this.cached(
      this.k('margins', fromDate, toDate, opts.dateBasis, opts.nodeType, opts.nodeId),
      () => this.computePlatformMarginReport(fromDate, toDate, opts),
    );
  }

  private async computePlatformMarginReport(
    fromDate: Date,
    toDate: Date,
    opts: { dateBasis?: MarginDateBasis; nodeType?: ReportNodeType; nodeId?: string } = {},
  ) {
    const dateBasis: MarginDateBasis = opts.dateBasis === 'settled' ? 'settled' : 'created';
    const nodeType: ReportNodeType = opts.nodeType ?? 'ALL';
    const wantSellers = nodeType === 'ALL' || nodeType === 'SELLER';
    const wantFranchises = nodeType === 'ALL' || nodeType === 'FRANCHISE';

    // #5 — date-basis toggle. created = when the commission was recognised;
    // settled = when its settlement was PAID (the finance-close view). For
    // settled-basis we filter through the commission→settlement relation.
    const sellerWhere: Prisma.CommissionRecordWhereInput =
      dateBasis === 'settled'
        ? { sellerSettlement: { is: { status: 'PAID', paidAt: { gte: fromDate, lte: toDate } } } }
        : { createdAt: { gte: fromDate, lte: toDate } };
    if (opts.nodeId && wantSellers) (sellerWhere as any).sellerId = opts.nodeId; // #15

    const [sellerMargins, franchiseOnline, franchiseProc] = await Promise.all([
      wantSellers
        ? this.prisma.commissionRecord.groupBy({
            by: ['sellerId', 'sellerName'],
            where: sellerWhere,
            _sum: {
              totalPlatformAmount: true,
              totalSettlementAmount: true,
              platformMargin: true,
              refundedAdminEarning: true, // #12 — net refunds out of revenue + margin
            },
            _count: { id: true },
            orderBy: { _sum: { platformMargin: 'desc' } },
          })
        : Promise.resolve([]),
      // #4/#6(from #179) — franchise revenue = ONLINE_ORDER base only (procurement
      // / penalty rows are NOT revenue); margin = online + procurement earning.
      wantFranchises
        ? this.prisma.franchiseFinanceLedger.groupBy({
            by: ['franchiseId'],
            where: {
              createdAt: { gte: fromDate, lte: toDate },
              sourceType: 'ONLINE_ORDER',
              status: { not: 'REVERSED' },
              ...(opts.nodeId ? { franchiseId: opts.nodeId } : {}),
            },
            _sum: { baseAmount: true, platformEarning: true, franchiseEarning: true },
            _count: { id: true },
          })
        : Promise.resolve([]),
      wantFranchises
        ? this.prisma.franchiseFinanceLedger.groupBy({
            by: ['franchiseId'],
            where: {
              createdAt: { gte: fromDate, lte: toDate },
              sourceType: 'PROCUREMENT_FEE',
              status: { not: 'REVERSED' },
              ...(opts.nodeId ? { franchiseId: opts.nodeId } : {}),
            },
            _sum: { platformEarning: true },
          })
        : Promise.resolve([]),
    ]);

    const franchiseIds = franchiseOnline.map((f) => f.franchiseId);
    const franchises =
      franchiseIds.length > 0
        ? await this.prisma.franchisePartner.findMany({
            where: { id: { in: franchiseIds } },
            select: { id: true, businessName: true },
          })
        : [];
    const franchiseNameMap = new Map(franchises.map((f) => [f.id, f.businessName]));
    const procMargin = new Map(franchiseProc.map((p) => [p.franchiseId, dec(p._sum.platformEarning)]));

    const sellerReport = sellerMargins.map((s) => {
      const revenue = dec(s._sum.totalPlatformAmount).minus(dec(s._sum.refundedAdminEarning)); // #12
      const margin = dec(s._sum.platformMargin).minus(dec(s._sum.refundedAdminEarning)); // #12
      return {
        nodeType: 'SELLER' as const,
        nodeId: s.sellerId,
        nodeName: s.sellerName,
        totalRecords: s._count.id,
        totalRevenue: revenue.toFixed(2),
        totalPayable: dec(s._sum.totalSettlementAmount).toFixed(2),
        platformMargin: margin.toFixed(2),
        marginPercentage: revenue.gt(0) ? margin.div(revenue).times(100).toDecimalPlaces(2).toNumber() : 0,
      };
    });

    const franchiseReport = franchiseOnline
      .map((f) => {
        const revenue = dec(f._sum.baseAmount);
        const margin = dec(f._sum.platformEarning).plus(procMargin.get(f.franchiseId) ?? ZERO);
        return {
          nodeType: 'FRANCHISE' as const,
          nodeId: f.franchiseId,
          nodeName: franchiseNameMap.get(f.franchiseId) || 'Unknown',
          totalRecords: f._count.id,
          totalRevenue: revenue.toFixed(2),
          totalPayable: dec(f._sum.franchiseEarning).toFixed(2),
          platformMargin: margin.toFixed(2),
          marginPercentage: revenue.gt(0) ? margin.div(revenue).times(100).toDecimalPlaces(2).toNumber() : 0,
        };
      })
      .sort((a, b) => Number(b.platformMargin) - Number(a.platformMargin));

    const totalSellerMargin = sellerReport.reduce((sum, s) => sum.plus(new Prisma.Decimal(s.platformMargin)), ZERO);
    const totalFranchiseMargin = franchiseReport.reduce((sum, f) => sum.plus(new Prisma.Decimal(f.platformMargin)), ZERO);

    return {
      period: { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() },
      dateBasis,
      nodeType,
      summary: {
        totalPlatformMargin: totalSellerMargin.plus(totalFranchiseMargin).toFixed(2),
        totalSellerMargin: totalSellerMargin.toFixed(2),
        totalFranchiseMargin: totalFranchiseMargin.toFixed(2),
      },
      revenueBasis: {
        sellers: 'Commission base (totalPlatformAmount) net of refunded admin earning',
        franchises: 'ONLINE_ORDER ledger base; margin = online + procurement platform earning',
      },
      methodology:
        'Margins are net of refunds (refundedAdminEarning). Seller date-basis is ' +
        `'${dateBasis}'. Platform-level expenses (affiliate payouts, goodwill, chargebacks) are reported separately, not netted per node.`,
      sellers: sellerReport,
      franchises: franchiseReport,
    };
  }

  async getPayoutReport(
    fromDate: Date,
    toDate: Date,
    opts: { nodeType?: ReportNodeType | 'AFFILIATE'; nodeId?: string } = {},
  ) {
    return this.cached(
      this.k('payouts', fromDate, toDate, opts.nodeType, opts.nodeId),
      () => this.computePayoutReport(fromDate, toDate, opts),
    );
  }

  private async computePayoutReport(
    fromDate: Date,
    toDate: Date,
    opts: { nodeType?: ReportNodeType | 'AFFILIATE'; nodeId?: string } = {},
  ) {
    const nodeType = opts.nodeType ?? 'ALL';
    const wantSellers = nodeType === 'ALL' || nodeType === 'SELLER';
    const wantFranchises = nodeType === 'ALL' || nodeType === 'FRANCHISE';
    const wantAffiliates = nodeType === 'ALL' || nodeType === 'AFFILIATE';

    // #13 — PAID rows carry paidAt; PARTIALLY_PAID rows don't (paidAt is set only
    // on full payment) so they're windowed by updatedAt (when the partial wire
    // was recorded). Both surfaced with an explicit `status`.
    const paidWindow = { paidAt: { gte: fromDate, lte: toDate } };
    const partialWindow = { updatedAt: { gte: fromDate, lte: toDate } };

    const [sellerPayouts, franchisePayouts, affiliatePayouts] = await Promise.all([
      wantSellers
        ? this.prisma.sellerSettlement.findMany({
            where: {
              OR: [{ status: 'PAID', ...paidWindow }, { status: 'PARTIALLY_PAID', ...partialWindow }],
              ...(opts.nodeId ? { sellerId: opts.nodeId } : {}),
            },
            orderBy: [{ paidAt: 'desc' }, { updatedAt: 'desc' }],
            select: {
              id: true, sellerId: true, sellerName: true, status: true,
              totalSettlementAmount: true,
              totalSettlementAmountInPaise: true, tcsDeductedInPaise: true,
              tdsDeductedInPaise: true, totalCommissionGstInPaise: true,
              paidAmountInPaise: true, totalPlatformMargin: true,
              paidAt: true, updatedAt: true, utrReference: true,
              cycle: { select: { id: true, periodStart: true, periodEnd: true } },
            },
          })
        : Promise.resolve([]),
      wantFranchises
        ? this.prisma.franchiseSettlement.findMany({
            where: {
              OR: [{ status: 'PAID', ...paidWindow }, { status: 'PARTIALLY_PAID', ...partialWindow }],
              ...(opts.nodeId ? { franchiseId: opts.nodeId } : {}),
            },
            orderBy: [{ paidAt: 'desc' }, { updatedAt: 'desc' }],
            select: {
              id: true, franchiseId: true, franchiseName: true, status: true,
              netPayableToFranchise: true, paidAmountInPaise: true,
              totalPlatformEarning: true, paidAt: true, updatedAt: true, paymentReference: true,
              cycle: { select: { id: true, periodStart: true, periodEnd: true } },
            },
          })
        : Promise.resolve([]),
      // #14 — affiliate payouts (§194-O TDS already deducted; netAmount is wired).
      wantAffiliates
        ? this.prisma.affiliatePayoutRequest.findMany({
            where: { status: 'PAID', paidAt: { gte: fromDate, lte: toDate }, ...(opts.nodeId ? { affiliateId: opts.nodeId } : {}) },
            orderBy: { paidAt: 'desc' },
            select: {
              id: true, affiliateId: true, grossAmount: true, tdsAmount: true,
              netAmount: true, paidAt: true, transactionRef: true,
              affiliate: { select: { firstName: true, lastName: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    // ── seller rows: net = gross − TCS − TDS − commission-GST (paise, exact). ──
    const sellerRows = sellerPayouts.map((s) => {
      // Gross from the AUTHORITATIVE decimal (the *InPaise sibling is 0 on
      // legacy / dual-write-off rows); net clamped ≥0 via the canonical helper.
      const grossPaise = BigInt(dec(s.totalSettlementAmount).times(100).toFixed(0));
      const netPaise = settlementNetFromRow(s, grossPaise);
      const amountPaidPaise = s.status === 'PAID' ? netPaise : s.paidAmountInPaise;
      return {
        nodeType: 'SELLER' as const,
        settlementId: s.id,
        nodeId: s.sellerId,
        nodeName: s.sellerName,
        status: s.status,
        grossAmount: paiseToRupees(grossPaise),
        tcsDeducted: paiseToRupees(s.tcsDeductedInPaise),
        tdsDeducted: paiseToRupees(s.tdsDeductedInPaise),
        commissionGst: paiseToRupees(s.totalCommissionGstInPaise),
        netAmountPaid: paiseToRupees(amountPaidPaise), // #6 — actual bank wire
        platformMargin: dec(s.totalPlatformMargin).toFixed(2),
        paidAt: s.paidAt ?? s.updatedAt,
        paymentReference: s.utrReference,
        cycleId: s.cycle.id,
        cyclePeriod: `${s.cycle.periodStart.toISOString()} - ${s.cycle.periodEnd.toISOString()}`,
        _net: amountPaidPaise,
      };
    });

    // ── franchise rows: already net (no TCS/TDS on franchise payouts). ──
    const franchiseRows = franchisePayouts.map((f) => {
      const netPaise = BigInt(dec(f.netPayableToFranchise).times(100).toFixed(0));
      const amountPaidPaise = f.status === 'PAID' ? netPaise : f.paidAmountInPaise;
      return {
        nodeType: 'FRANCHISE' as const,
        settlementId: f.id,
        nodeId: f.franchiseId,
        nodeName: f.franchiseName,
        status: f.status,
        grossAmount: dec(f.netPayableToFranchise).toFixed(2),
        tcsDeducted: '0.00',
        tdsDeducted: '0.00',
        commissionGst: '0.00',
        netAmountPaid: paiseToRupees(amountPaidPaise),
        platformMargin: dec(f.totalPlatformEarning).toFixed(2),
        paidAt: f.paidAt ?? f.updatedAt,
        paymentReference: f.paymentReference,
        cycleId: f.cycle.id,
        cyclePeriod: `${f.cycle.periodStart.toISOString()} - ${f.cycle.periodEnd.toISOString()}`,
        _net: amountPaidPaise,
      };
    });

    // ── affiliate rows: netAmount is the wired figure. ──
    const affiliateRows = affiliatePayouts.map((a) => {
      const netPaise = BigInt(dec(a.netAmount).times(100).toFixed(0));
      return {
        nodeType: 'AFFILIATE' as const,
        settlementId: a.id,
        nodeId: a.affiliateId,
        nodeName: `${a.affiliate.firstName} ${a.affiliate.lastName}`.trim(),
        status: 'PAID',
        grossAmount: dec(a.grossAmount).toFixed(2),
        tcsDeducted: '0.00',
        tdsDeducted: dec(a.tdsAmount).toFixed(2),
        commissionGst: '0.00',
        netAmountPaid: dec(a.netAmount).toFixed(2),
        platformMargin: '0.00',
        paidAt: a.paidAt,
        paymentReference: a.transactionRef,
        cycleId: null,
        cyclePeriod: null,
        _net: netPaise,
      };
    });

    const sumPaise = (rows: Array<{ _net: bigint }>) => rows.reduce((acc, r) => acc + r._net, 0n);
    const strip = <T extends { _net: bigint }>(rows: T[]) => rows.map(({ _net, ...rest }) => rest);

    return {
      period: { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() },
      nodeType,
      summary: {
        totalNetPaidOut: paiseToRupees(sumPaise(sellerRows) + sumPaise(franchiseRows) + sumPaise(affiliateRows)),
        totalSellerPayouts: paiseToRupees(sumPaise(sellerRows)),
        totalFranchisePayouts: paiseToRupees(sumPaise(franchiseRows)),
        totalAffiliatePayouts: paiseToRupees(sumPaise(affiliateRows)),
        sellerPayoutCount: sellerRows.length,
        franchisePayoutCount: franchiseRows.length,
        affiliatePayoutCount: affiliateRows.length,
      },
      note: 'Amounts are NET of statutory deductions (TCS/TDS/commission-GST) — i.e. the actual bank wire, not the gross settlement. PARTIALLY_PAID rows show the disbursed-so-far amount.',
      sellerPayouts: strip(sellerRows),
      franchisePayouts: strip(franchiseRows),
      affiliatePayouts: strip(affiliateRows),
    };
  }

  // #8 — date-scoped (was all-time only). `createdAt` windows the recognition-
  // side aggregates; `paidAt` windows the settled side.
  async getReconciliationReport(fromDate?: Date, toDate?: Date) {
    return this.cached(this.k('recon', fromDate, toDate), () =>
      this.computeReconciliationReport(fromDate, toDate),
    );
  }

  private async computeReconciliationReport(fromDate?: Date, toDate?: Date) {
    const created = fromDate && toDate ? { createdAt: { gte: fromDate, lte: toDate } } : {};
    const paid = fromDate && toDate ? { paidAt: { gte: fromDate, lte: toDate } } : {};

    const [
      sellerPlatformRevenue,
      sellerMarginAgg,
      sellerPendingAgg,
      sellerSettledAgg,
      settledCommissionMarginAgg, // #20 cross-check A
      paidSettlementMarginAgg, // #20 cross-check A
      orphanedSettledCommissions, // #20 cross-check B
      franchiseLedgerAgg,
      franchisePendingAgg,
      franchiseSettledAgg,
      totalLedgerEntries,
    ] = await Promise.all([
      this.prisma.commissionRecord.aggregate({ where: created, _sum: { totalPlatformAmount: true }, _count: { id: true } }),
      this.prisma.commissionRecord.aggregate({ where: created, _sum: { platformMargin: true, refundedAdminEarning: true } }),
      this.prisma.commissionRecord.aggregate({ where: { status: 'PENDING', ...created }, _sum: { totalSettlementAmount: true }, _count: { id: true } }),
      this.prisma.sellerSettlement.aggregate({ where: { status: 'PAID', ...paid }, _sum: { totalSettlementAmount: true }, _count: { id: true } }),
      // A: settled-commission margin vs the paid-settlement margin — INDEPENDENT
      // writers, so a divergence is a real integrity signal (not a tautology).
      this.prisma.commissionRecord.aggregate({ where: { status: 'SETTLED', ...created }, _sum: { platformMargin: true } }),
      this.prisma.sellerSettlement.aggregate({ where: { status: 'PAID', ...paid }, _sum: { totalPlatformMargin: true } }),
      // B: commissions that claim SETTLED but link to no settlement (orphans).
      this.prisma.commissionRecord.count({ where: { status: 'SETTLED', settlementId: null, ...created } }),
      this.prisma.franchiseFinanceLedger.aggregate({ where: { status: { not: 'REVERSED' }, ...created }, _sum: { baseAmount: true, platformEarning: true, franchiseEarning: true } }),
      this.prisma.franchiseSettlement.aggregate({ where: { status: 'PENDING', ...created }, _sum: { netPayableToFranchise: true }, _count: { id: true } }),
      this.prisma.franchiseSettlement.aggregate({ where: { status: 'PAID', ...paid }, _sum: { netPayableToFranchise: true }, _count: { id: true } }),
      this.prisma.franchiseFinanceLedger.count({ where: { status: { not: 'REVERSED' }, ...created } }),
    ]);

    const mismatches: string[] = [];

    // #20 cross-check A — settled commission margin vs paid settlement margin.
    const settledCommissionMargin = dec(settledCommissionMarginAgg._sum.platformMargin);
    const paidSettlementMargin = dec(paidSettlementMarginAgg._sum.totalPlatformMargin);
    if (settledCommissionMargin.minus(paidSettlementMargin).abs().gt(new Prisma.Decimal('0.01'))) {
      mismatches.push(
        `Settled-commission margin (${settledCommissionMargin.toFixed(2)}) ≠ paid-settlement margin (${paidSettlementMargin.toFixed(2)})`,
      );
    }
    // #20 cross-check B — orphaned settled commissions.
    if (orphanedSettledCommissions > 0) {
      mismatches.push(`${orphanedSettledCommissions} commission record(s) marked SETTLED but linked to no settlement`);
    }

    const sellerMargin = dec(sellerMarginAgg._sum.platformMargin).minus(dec(sellerMarginAgg._sum.refundedAdminEarning));
    const franchisePlatformEarning = dec(franchiseLedgerAgg._sum.platformEarning);

    return {
      period: fromDate && toDate ? { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() } : { fromDate: null, toDate: null, note: 'all-time (no range supplied)' },
      seller: {
        totalPlatformRevenue: dec(sellerPlatformRevenue._sum.totalPlatformAmount).toFixed(2),
        totalPlatformMargin: sellerMargin.toFixed(2),
        totalCommissionRecords: sellerPlatformRevenue._count.id,
        pendingSettlements: { count: sellerPendingAgg._count.id, amount: dec(sellerPendingAgg._sum.totalSettlementAmount).toFixed(2) },
        settledPayments: { count: sellerSettledAgg._count.id, amount: dec(sellerSettledAgg._sum.totalSettlementAmount).toFixed(2) },
      },
      franchise: {
        totalBaseAmount: dec(franchiseLedgerAgg._sum.baseAmount).toFixed(2),
        totalPlatformEarning: franchisePlatformEarning.toFixed(2),
        totalFranchiseEarning: dec(franchiseLedgerAgg._sum.franchiseEarning).toFixed(2),
        totalLedgerEntries,
        pendingSettlements: { count: franchisePendingAgg._count.id, amount: dec(franchisePendingAgg._sum.netPayableToFranchise).toFixed(2) },
        settledPayments: { count: franchiseSettledAgg._count.id, amount: dec(franchiseSettledAgg._sum.netPayableToFranchise).toFixed(2) },
      },
      combined: {
        totalPlatformEarnings: sellerMargin.plus(franchisePlatformEarning).toFixed(2),
        totalPayableOutstanding: dec(sellerPendingAgg._sum.totalSettlementAmount).plus(dec(franchisePendingAgg._sum.netPayableToFranchise)).toFixed(2),
        totalPaid: dec(sellerSettledAgg._sum.totalSettlementAmount).plus(dec(franchiseSettledAgg._sum.netPayableToFranchise)).toFixed(2),
      },
      integrityChecks: {
        settledCommissionMargin: settledCommissionMargin.toFixed(2),
        paidSettlementMargin: paidSettlementMargin.toFixed(2),
        orphanedSettledCommissions,
      },
      isReconciled: mismatches.length === 0,
      mismatches,
    };
  }
}
