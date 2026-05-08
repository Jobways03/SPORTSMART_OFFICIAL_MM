import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';

/**
 * Phase 5 (PR 5.5) — Customer abuse soft-hold counter.
 *
 * Computes a customer's rolling-90-day return rate and flips
 * `requiresManualApproval` when both:
 *   - returnsLast90d >= CUSTOMER_ABUSE_MIN_RETURNS, and
 *   - returnRateBps  > CUSTOMER_ABUSE_RATE_THRESHOLD_BPS
 *
 * Either threshold at 0 disables the feature entirely (the recompute
 * always runs but never flags).
 *
 * Read pattern (return creation hot path):
 *   const flagged = await abuseCounter.shouldHoldForManualReview(customerId);
 *   if (flagged) await this.returnRepo.update(returnId, { autoApprove: false });
 *
 * Write pattern (return creation tail + nightly cron):
 *   await abuseCounter.recompute(customerId);
 *
 * `recompute` rebuilds the counter from a single SELECT against
 * MasterOrder + Return + Dispute. Two reasons not to maintain the
 * counters incrementally:
 *   - Window expiry (orders >90d old fall out of the count) needs a
 *     full re-aggregate anyway.
 *   - The ops effort of "did we miss a counter increment somewhere?"
 *     after every refactor is a tax we don't want to pay.
 *
 * The hot-path read is a single primary-key lookup — fast even at our
 * peak return rate.
 */
@Injectable()
export class CustomerAbuseCounterService {
  private readonly logger = new Logger(CustomerAbuseCounterService.name);

  /**
   * Customer-record shape used in tests + when mocking. Keep in sync
   * with the Prisma schema.
   */
  static readonly WINDOW_DAYS = 90;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  /**
   * Cheap read for the create-return hot path. Returns false when the
   * counter row doesn't exist yet (new customer / never recomputed).
   */
  async shouldHoldForManualReview(customerId: string): Promise<boolean> {
    const row = await this.prisma.customerAbuseCounter.findUnique({
      where: { customerId },
      select: { requiresManualApproval: true },
    });
    return !!row?.requiresManualApproval;
  }

  /**
   * Re-aggregate the rolling 90-day window for the given customer and
   * upsert the counter row. Safe to call concurrently — Postgres'
   * upsert + the row primary key serialise the writes.
   */
  async recompute(customerId: string): Promise<void> {
    const minReturns = this.env.getNumber('CUSTOMER_ABUSE_MIN_RETURNS', 0);
    const rateBps = this.env.getNumber('CUSTOMER_ABUSE_RATE_THRESHOLD_BPS', 0);

    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(
      windowStart.getDate() - CustomerAbuseCounterService.WINDOW_DAYS,
    );

    // Three independent counts in parallel — they read from disjoint
    // tables, no point serialising.
    const [orders, returns, disputes] = await Promise.all([
      this.prisma.masterOrder.count({
        where: {
          customerId,
          createdAt: { gte: windowStart },
        },
      }),
      this.prisma.return.count({
        where: {
          customerId,
          createdAt: { gte: windowStart },
        },
      }),
      this.prisma.dispute.count({
        where: {
          filedByType: 'CUSTOMER',
          filedById: customerId,
          createdAt: { gte: windowStart },
        },
      }),
    ]);

    const returnRateBps =
      orders === 0 ? null : Math.floor((returns * 10_000) / orders);

    let requiresManualApproval = false;
    let flagReason: string | null = null;
    if (
      minReturns > 0 &&
      rateBps > 0 &&
      returns >= minReturns &&
      returnRateBps !== null &&
      returnRateBps > rateBps
    ) {
      requiresManualApproval = true;
      flagReason = `${returns} returns in ${CustomerAbuseCounterService.WINDOW_DAYS}d, return rate ${(returnRateBps / 100).toFixed(2)}% (threshold ${(rateBps / 100).toFixed(2)}%)`;
    }

    await this.prisma.customerAbuseCounter.upsert({
      where: { customerId },
      create: {
        customerId,
        windowStart,
        windowEnd: now,
        ordersLast90d: orders,
        returnsLast90d: returns,
        disputesLast90d: disputes,
        returnRateBps,
        requiresManualApproval,
        flagReason,
      },
      update: {
        windowStart,
        windowEnd: now,
        ordersLast90d: orders,
        returnsLast90d: returns,
        disputesLast90d: disputes,
        returnRateBps,
        requiresManualApproval,
        flagReason,
      },
    });

    if (requiresManualApproval) {
      this.logger.warn(
        `Customer ${customerId} flagged for manual approval — ${flagReason}`,
      );
    }
  }
}
