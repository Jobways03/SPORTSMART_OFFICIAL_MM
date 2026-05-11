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

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

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
}

@Injectable()
export class DiscountAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute the analytics summary for the given date range. Default
   * range: last 30 days (inclusive) ending now.
   */
  async getAnalytics(range: DateRange = {}): Promise<DiscountAnalyticsSummary> {
    const toDate = range.toDate ?? new Date();
    const fromDate =
      range.fromDate ?? new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      redemptionsByStatus,
      orderDiscountAgg,
      orderDiscountByFunding,
      liabilityByParty,
      reversalAgg,
      topByRevenue,
      topByLoss,
    ] = await Promise.all([
      this.prisma.discountRedemption.groupBy({
        by: ['status'],
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _count: true,
      }),
      this.prisma.orderDiscount.aggregate({
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _sum: { discountAmountInPaise: true },
        _count: true,
      }),
      this.prisma.orderDiscount.groupBy({
        by: ['fundingType'],
        where: { createdAt: { gte: fromDate, lte: toDate } },
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
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _sum: { discountAmountInPaise: true },
        _count: true,
        orderBy: { _sum: { discountAmountInPaise: 'desc' } },
        take: 10,
      }),
      // "Top by loss" = top discounts by reversed amount. We join
      // through orderItemId → orderDiscount to find the discountId
      // since return_tax_reversal_lines doesn't carry it directly.
      // For simplicity we use a raw query.
      this.topCouponsByLoss(fromDate, toDate),
    ]);

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
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        oid.discount_id,
        oid.discount_code,
        COUNT(rtrl.id) AS reversal_count,
        COALESCE(SUM(rtrl.total_credit_note_amount_in_paise), 0) AS total_reversal_in_paise
      FROM return_tax_reversal_lines rtrl
      INNER JOIN order_item_discounts oid
        ON oid.order_item_id = rtrl.order_item_id
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
