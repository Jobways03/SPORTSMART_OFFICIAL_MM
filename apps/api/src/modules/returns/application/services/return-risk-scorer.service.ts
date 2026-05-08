import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { CustomerAbuseCounterService } from './customer-abuse-counter.service';
import {
  assessReturnRisk,
  RiskAssessment,
  RiskSnapshot,
} from './return-risk-scorer';

/**
 * Phase 13 (P1.11) — orchestrator that fetches the snapshot inputs
 * from the DB, hands them to the pure-function scorer, and persists
 * the result back onto the Return row.
 *
 * Kept as a thin shell so the unit tests can target the pure scorer
 * directly. Service-layer concerns:
 *   - read CustomerAbuseCounter (already exists)
 *   - count recent returns for the customer
 *   - count chargebacks for the customer (placeholder until the
 *     chargeback table lands; defaults to 0 today)
 *   - compute total value from the items
 *   - persist {score, flags, scoredAt} back onto the return
 */
@Injectable()
export class ReturnRiskScorerService {
  private readonly logger = new Logger(ReturnRiskScorerService.name);

  /** How far back to look for "recent returns". 30 days per spec. */
  static readonly RECENT_WINDOW_DAYS = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly abuseCounter: CustomerAbuseCounterService,
  ) {}

  /**
   * Score a freshly created return and persist the result onto the row.
   * Fully best-effort — a scorer failure should never block return
   * creation. Returns the assessment for callers that want to act on
   * it immediately (auto-approval service is the main one).
   */
  async scoreAndPersist(args: {
    returnId: string;
    customerId: string;
    items: Array<{ unitPrice: number; quantity: number; reasonCategory: string }>;
    evidenceCount: number;
    /**
     * Phase 13 completion — optional aggregate inputs for the
     * seller and courier risk dimensions. If omitted, the
     * orchestrator queries them itself; passing them in lets
     * callers (tests, batch backfills) override.
     */
    sellerId?: string | null;
    courierName?: string | null;
  }): Promise<RiskAssessment | null> {
    try {
      const snapshot = await this.buildSnapshot(args);
      const assessment = assessReturnRisk(snapshot);
      await this.prisma.return.update({
        where: { id: args.returnId },
        data: {
          riskScore: assessment.score,
          riskFlags: assessment.flags as any,
          riskScoredAt: new Date(),
        },
      });
      this.logger.log(
        `Return ${args.returnId} risk-scored: ${assessment.score} (${assessment.level}) flags=[${assessment.flags.join(',')}]`,
      );
      return assessment;
    } catch (err) {
      // Best-effort: swallow + log so return creation never fails on
      // a scorer outage. Auto-approval will fall back to the legacy
      // path (rules without risk input) when riskScore is null.
      this.logger.error(
        `Risk scoring failed for return ${args.returnId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async buildSnapshot(args: {
    customerId: string;
    items: Array<{ unitPrice: number; quantity: number; reasonCategory: string }>;
    evidenceCount: number;
    sellerId?: string | null;
    courierName?: string | null;
  }): Promise<RiskSnapshot> {
    const totalValueInPaise = args.items.reduce(
      (sum, it) =>
        sum + Math.round(Number(it.unitPrice) * 100) * it.quantity,
      0,
    );

    const recentWindowStart = new Date();
    recentWindowStart.setDate(
      recentWindowStart.getDate() -
        ReturnRiskScorerService.RECENT_WINDOW_DAYS,
    );
    // Seller-side aggregate uses a longer window (90 days) since
    // wrong-item-rate is meaningful only at scale.
    const sellerWindowStart = new Date();
    sellerWindowStart.setDate(sellerWindowStart.getDate() - 90);

    const [
      flaggedForAbuse,
      recentReturnCount,
      chargebackCountLifetime,
      sellerAgg,
      courierDamageCount,
    ] = await Promise.all([
      this.abuseCounter.shouldHoldForManualReview(args.customerId),
      this.prisma.return.count({
        where: {
          customerId: args.customerId,
          createdAt: { gte: recentWindowStart },
        },
      }),
      // Chargeback table doesn't exist yet — placeholder returns 0.
      Promise.resolve(0),
      // Seller wrong-item rate over the last 90 days. Joins through
      // sub_orders to find returns served by this seller.
      args.sellerId
        ? this.computeSellerWrongItemRate(args.sellerId, sellerWindowStart)
        : Promise.resolve(undefined),
      // Courier damage hotspot — count of DAMAGED_IN_TRANSIT returns
      // shipped via the same courier in the last 30 days. We look at
      // SubOrder.courierName (the forward-shipment courier; pickup
      // courier is on Return itself but that's set later).
      args.courierName
        ? this.prisma.return.count({
            where: {
              createdAt: { gte: recentWindowStart },
              subOrder: { courierName: args.courierName },
              items: { some: { reasonCategory: 'DAMAGED_IN_TRANSIT' as any } },
            },
          })
        : Promise.resolve(0),
    ]);

    return {
      totalValueInPaise,
      evidenceCount: args.evidenceCount,
      reasonCategories: args.items.map((i) => i.reasonCategory),
      customer: {
        flaggedForAbuse,
        recentReturnCount,
        chargebackCountLifetime,
      },
      seller: sellerAgg,
      courier: args.courierName
        ? {
            damageClaimsInWindow: courierDamageCount,
            courierName: args.courierName,
          }
        : undefined,
    };
  }

  /**
   * Aggregates the seller's wrong-item rate over the given window.
   * Joins returns → sub_order to filter by seller. Cheap (one count
   * for total, one count for WRONG_ITEM); both run via Prisma so
   * connection pooling handles concurrency.
   */
  private async computeSellerWrongItemRate(
    sellerId: string,
    windowStart: Date,
  ): Promise<{ wrongItemRateBps: number; totalReturnsInWindow: number }> {
    const [total, wrongItem] = await Promise.all([
      this.prisma.return.count({
        where: {
          createdAt: { gte: windowStart },
          subOrder: { sellerId },
        },
      }),
      this.prisma.return.count({
        where: {
          createdAt: { gte: windowStart },
          subOrder: { sellerId },
          items: { some: { reasonCategory: 'WRONG_ITEM' as any } },
        },
      }),
    ]);
    const rateBps = total === 0 ? 0 : Math.floor((wrongItem * 10_000) / total);
    return { wrongItemRateBps: rateBps, totalReturnsInWindow: total };
  }
}
