// Phase F (P2.2) — Discount campaign analytics service.
//
// Read-only aggregation queries over the discount allocation +
// liability ledger + redemption tables. Backs the admin analytics
// dashboard at /dashboard/discounts/analytics.
//
// All reads are scoped to a date range (default last 30 days).
// Heavy aggregations (sum/group-by) run in Postgres directly via
// Prisma.aggregate / groupBy — fast for tens-of-thousands of rows
// without app-layer churn.
//
// Notes on what's NOT here yet:
//   - Conversion rate: needs order-funnel data (cart→checkout→paid)
//     that lives outside this module. Stub returned.
//   - Abuse attempts: requires the `coupon_attempts` table (P1.4
//     fraud controls). Stub returned (count = 0 until P1 ships).
//   - Remaining budget: requires the budget columns on Discount
//     (P2.1 approval/budget). Stub returned (null per row).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

// Phase 246 (#9) — "committed spend" excludes orders whose discount never
// stuck: customer-cancelled, verifier-rejected, or never-paid-online. COD /
// placed orders (paymentStatus still PENDING but the order is live) are kept.
// Without this filter, cancelled-cart and abandoned-checkout discounts inflate
// every spend / funding / top-coupon figure and break finance reconciliation.
const NON_COMMITTED_ORDER_STATUSES = [
  'CANCELLED',
  'REJECTED',
  'PENDING_PAYMENT',
];
const COMMITTED_ORDER_FILTER = {
  masterOrder: { orderStatus: { notIn: NON_COMMITTED_ORDER_STATUSES as any } },
};

export interface DateRange {
  fromDate?: Date | null;
  toDate?: Date | null;
}

export interface DiscountAnalyticsSummary {
  range: { fromDate: string; toDate: string };
  redemptions: {
    /** Successful (REDEEMED status) redemptions in the range. */
    redeemed: number;
    /** Reservations that expired or failed. */
    released: number;
    /** Currently held reservations (RESERVED). */
    inFlight: number;
  };
  spend: {
    /** Total order-level discount spend in paise (sum of order_discounts). */
    totalDiscountInPaise: string;
    /** Per-funding-type spend roll-up. */
    byFundingType: Array<{
      fundingType: string;
      amountInPaise: string;
      count: number;
    }>;
  };
  liability: {
    /** Per-party liability roll-up from discount_liability_ledger. */
    byParty: Array<{
      liabilityParty: string;
      amountInPaise: string;
      entryCount: number;
    }>;
  };
  refundImpact: {
    /** Sum of return_tax_reversal_lines.discountReversalInPaise. */
    discountReversedInPaise: string;
    /** Sum of return_tax_reversal_lines.totalCreditNoteAmountInPaise. */
    totalCreditNoteInPaise: string;
    reversalCount: number;
  };
  topCoupons: {
    /** Top 10 by total discount spend. */
    byRevenue: Array<{
      discountId: string;
      discountCode: string | null;
      redemptionCount: number;
      totalDiscountInPaise: string;
    }>;
    /** Top 10 by refund/reversal cost. */
    byLoss: Array<{
      discountId: string;
      discountCode: string | null;
      reversalCount: number;
      totalReversalInPaise: string;
    }>;
  };
  abuse: {
    /** Stub until P1.4 fraud controls land. */
    attemptCount: number;
    blockedCount: number;
  };
  /**
   * Phase 246 (#12) — when a single sub-query fails, the dashboard renders
   * the cards that succeeded and lists the ones that didn't here, instead of
   * 500-ing the whole page.
   */
  _errors?: string[];
}

@Injectable()
export class DiscountAnalyticsService {
  private readonly logger = new Logger(DiscountAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute the analytics summary for the given date range. Default
   * range: last 30 days (inclusive) ending now.
   */
  async getAnalytics(range: DateRange = {}): Promise<DiscountAnalyticsSummary> {
    const toDate = range.toDate ?? new Date();
    const fromDate =
      range.fromDate ?? new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Phase 246 (#12) — allSettled (not all): one slow/locked table can't
    // take down the whole dashboard. Each card falls back to a safe empty
    // value and the failure is surfaced in `_errors`.
    const settled: PromiseSettledResult<any>[] = await Promise.allSettled([
      this.prisma.discountRedemption.groupBy({
        by: ['status'],
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _count: true,
      }),
      this.prisma.orderDiscount.aggregate({
        // #9 — committed spend only.
        where: { createdAt: { gte: fromDate, lte: toDate }, ...COMMITTED_ORDER_FILTER },
        _sum: { discountAmountInPaise: true },
        _count: true,
      }),
      this.prisma.orderDiscount.groupBy({
        by: ['fundingType'],
        where: { createdAt: { gte: fromDate, lte: toDate }, ...COMMITTED_ORDER_FILTER },
        _sum: { discountAmountInPaise: true },
        _count: true,
      }),
      this.prisma.discountLiabilityLedger.groupBy({
        by: ['liabilityParty'],
        where: {
          createdAt: { gte: fromDate, lte: toDate },
          status: { in: ['APPLIED', 'SETTLED'] },
        },
        _sum: { amountInPaise: true },
        _count: true,
      }),
      this.prisma.returnTaxReversalLine.aggregate({
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _sum: {
          discountReversalInPaise: true,
          totalCreditNoteAmountInPaise: true,
        },
        _count: true,
      }),
      this.prisma.orderDiscount.groupBy({
        by: ['discountId', 'discountCode'],
        where: { createdAt: { gte: fromDate, lte: toDate }, ...COMMITTED_ORDER_FILTER },
        _sum: { discountAmountInPaise: true },
        _count: true,
        orderBy: { _sum: { discountAmountInPaise: 'desc' } },
        take: 10,
      }),
      // "Top by loss" = top discounts by reversed amount. Joined through
      // orderItemId → order_item_discounts; #10 splits the reversal
      // proportionally across stacked discounts so a 2-discount item isn't
      // double-counted.
      this.topCouponsByLoss(fromDate, toDate),
    ]);

    const errors: string[] = [];
    const labels = [
      'redemptions',
      'spend',
      'spendByFunding',
      'liability',
      'refundImpact',
      'topByRevenue',
      'topByLoss',
    ];
    const pick = <T>(i: number, fallback: T): T => {
      const r = settled[i];
      if (r && r.status === 'fulfilled') return r.value as T;
      const label = labels[i] ?? `query${i}`;
      errors.push(label);
      if (r && r.status === 'rejected') {
        this.logger.warn(
          `Discount analytics query "${label}" failed: ${
            (r.reason as Error)?.message ?? r.reason
          }`,
        );
      }
      return fallback;
    };

    const redemptionsByStatus = pick<Array<{ status: string; _count: number }>>(
      0,
      [],
    );
    const orderDiscountAgg = pick<{
      _sum: { discountAmountInPaise: bigint | null };
      _count: number;
    }>(1, { _sum: { discountAmountInPaise: 0n }, _count: 0 });
    const orderDiscountByFunding = pick<
      Array<{ fundingType: string; _sum: { discountAmountInPaise: bigint | null }; _count: number }>
    >(2, []);
    const liabilityByParty = pick<
      Array<{ liabilityParty: string; _sum: { amountInPaise: bigint | null }; _count: number }>
    >(3, []);
    const reversalAgg = pick<{
      _sum: {
        discountReversalInPaise: bigint | null;
        totalCreditNoteAmountInPaise: bigint | null;
      };
      _count: number;
    }>(4, {
      _sum: { discountReversalInPaise: 0n, totalCreditNoteAmountInPaise: 0n },
      _count: 0,
    });
    const topByRevenue = pick<
      Array<{ discountId: string; discountCode: string | null; _sum: { discountAmountInPaise: bigint | null }; _count: number }>
    >(5, []);
    const topByLoss = pick<DiscountAnalyticsSummary['topCoupons']['byLoss']>(
      6,
      [],
    );

    const redeemed =
      redemptionsByStatus.find((r) => r.status === 'REDEEMED')?._count ?? 0;
    const released =
      redemptionsByStatus.find((r) => r.status === 'RELEASED')?._count ?? 0;
    const inFlight =
      redemptionsByStatus.find((r) => r.status === 'RESERVED')?._count ?? 0;

    return {
      range: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
      },
      redemptions: { redeemed, released, inFlight },
      spend: {
        totalDiscountInPaise: (
          orderDiscountAgg._sum.discountAmountInPaise ?? 0n
        ).toString(),
        byFundingType: orderDiscountByFunding.map((row) => ({
          fundingType: row.fundingType,
          amountInPaise: (row._sum.discountAmountInPaise ?? 0n).toString(),
          count: row._count,
        })),
      },
      liability: {
        byParty: liabilityByParty.map((row) => ({
          liabilityParty: row.liabilityParty,
          amountInPaise: (row._sum.amountInPaise ?? 0n).toString(),
          entryCount: row._count,
        })),
      },
      refundImpact: {
        discountReversedInPaise: (
          reversalAgg._sum.discountReversalInPaise ?? 0n
        ).toString(),
        totalCreditNoteInPaise: (
          reversalAgg._sum.totalCreditNoteAmountInPaise ?? 0n
        ).toString(),
        reversalCount: reversalAgg._count,
      },
      topCoupons: {
        byRevenue: topByRevenue.map((row) => ({
          discountId: row.discountId,
          discountCode: row.discountCode,
          redemptionCount: row._count,
          totalDiscountInPaise: (
            row._sum.discountAmountInPaise ?? 0n
          ).toString(),
        })),
        byLoss: topByLoss,
      },
      abuse: {
        // Stubs until P1.4 fraud controls (coupon_attempts table)
        // ships. The dashboard renders "Coming soon" for this card.
        attemptCount: 0,
        blockedCount: 0,
      },
      ...(errors.length ? { _errors: errors } : {}),
    };
  }

  /**
   * Phase 247-FB — funding-party receivables. Nets the discount liability
   * ledger by party + attributed franchise/brand so finance can see who owes
   * what: FRANCHISE rows are auto-deducted in the franchise settlement (this
   * is the cross-check); BRAND rows have no automated recovery yet, so this
   * report IS the manual-billing surface (sum each brand owes). Signed net
   * (APPLIED + SETTLED + REVERSED) so returns credit back.
   */
  async getFundingReceivables(range: DateRange = {}): Promise<{
    range: { fromDate: string; toDate: string };
    franchise: Array<{ franchiseId: string; netInPaise: string }>;
    brand: Array<{ brandId: string; netInPaise: string }>;
  }> {
    const toDate = range.toDate ?? new Date();
    const fromDate =
      range.fromDate ?? new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const whereBase = {
      createdAt: { gte: fromDate, lte: toDate },
      status: { in: ['APPLIED', 'SETTLED', 'REVERSED'] as any },
    };
    const [franchiseRows, brandRows] = await Promise.all([
      this.prisma.discountLiabilityLedger.groupBy({
        by: ['franchiseId'],
        where: { ...whereBase, liabilityParty: 'FRANCHISE' as any },
        _sum: { amountInPaise: true },
      }),
      this.prisma.discountLiabilityLedger.groupBy({
        by: ['brandId'],
        where: { ...whereBase, liabilityParty: 'BRAND' as any },
        _sum: { amountInPaise: true },
      }),
    ]);
    return {
      range: { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() },
      franchise: franchiseRows
        .filter((r) => r.franchiseId)
        .map((r) => ({
          franchiseId: r.franchiseId as string,
          netInPaise: (r._sum.amountInPaise ?? 0n).toString(),
        })),
      brand: brandRows
        .filter((r) => r.brandId)
        .map((r) => ({
          brandId: r.brandId as string,
          netInPaise: (r._sum.amountInPaise ?? 0n).toString(),
        })),
    };
  }

  /**
   * Top discounts by reversal cost (refund impact). Joined via
   * order_item_discounts since the reversal lines don't carry the
   * discountId directly.
   */
  private async topCouponsByLoss(
    fromDate: Date,
    toDate: Date,
  ): Promise<DiscountAnalyticsSummary['topCoupons']['byLoss']> {
    type Row = {
      discount_id: string;
      discount_code: string | null;
      reversal_count: bigint;
      total_reversal_in_paise: bigint;
    };
    // Phase 246 (#10) — an order item with N stacked discounts produces N
    // order_item_discounts rows, so a naive join fan-out summed each
    // reversal line N times. We split each reversal proportionally across
    // the discounts on the item (by each discount's share of the item's
    // total discount), so the amounts sum to the true reversal once.
    // reversal_count uses COUNT(DISTINCT rtrl.id) to avoid the same inflation.
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        oid.discount_id,
        oid.discount_code,
        COUNT(DISTINCT rtrl.id) AS reversal_count,
        COALESCE(
          ROUND(
            SUM(
              rtrl.total_credit_note_amount_in_paise::numeric
                * oid.discount_amount_in_paise::numeric
                / NULLIF(item_totals.total_disc, 0)
            )
          ),
          0
        )::bigint AS total_reversal_in_paise
      FROM return_tax_reversal_lines rtrl
      INNER JOIN order_item_discounts oid
        ON oid.order_item_id = rtrl.order_item_id
      INNER JOIN (
        SELECT order_item_id, SUM(discount_amount_in_paise) AS total_disc
        FROM order_item_discounts
        GROUP BY order_item_id
      ) item_totals
        ON item_totals.order_item_id = rtrl.order_item_id
      WHERE rtrl.created_at >= ${fromDate}
        AND rtrl.created_at <= ${toDate}
      GROUP BY oid.discount_id, oid.discount_code
      ORDER BY total_reversal_in_paise DESC
      LIMIT 10
    `;
    return rows.map((r) => ({
      discountId: r.discount_id,
      discountCode: r.discount_code,
      reversalCount: Number(r.reversal_count),
      totalReversalInPaise: r.total_reversal_in_paise.toString(),
    }));
  }
}
