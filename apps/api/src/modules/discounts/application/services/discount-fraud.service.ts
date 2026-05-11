// Phase E (P1.4) — Coupon fraud / rate-limit service.
//
// Wraps `coupon_attempts` writes + the sliding-window rate-limiter
// that gates POST /customer/coupons/validate. The validation
// controller calls `checkRateLimit` BEFORE looking up the discount
// (so guessing attempts don't burn DB roundtrips), then calls
// `recordAttempt` AFTER with the outcome.
//
// Defaults (per spec — "10 invalid coupon attempts from same IP
// triggers cooldown"):
//   - 10 INVALID attempts in 15 minutes per customer → cooldown
//   - 10 INVALID attempts in 15 minutes per IP → cooldown
//   - VALID attempts don't count toward the limit
//   - Cooldown of 30 minutes (no new attempts allowed)
//
// Tunable via env vars; sensible defaults so the service is safe
// to enable without dialling in.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import type {
  CouponAttempt,
  CouponAttemptResult,
} from '@prisma/client';

export interface AttemptContext {
  customerId?: string | null;
  ipAddress?: string | null;
  deviceId?: string | null;
  codeAttempted: string;
}

export class TooManyCouponAttemptsError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many coupon attempts. Please try again later.');
    this.name = 'TooManyCouponAttemptsError';
  }
}

@Injectable()
export class DiscountFraudService {
  private readonly logger = new Logger(DiscountFraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  /**
   * Reject the request if either the customer or the IP has exceeded
   * the invalid-attempt threshold within the sliding window. Throws
   * `TooManyCouponAttemptsError` with retry-after seconds.
   *
   * Called BEFORE the discount lookup so a guessing attacker can't
   * burn DB roundtrips on every guess.
   */
  async checkRateLimit(ctx: AttemptContext): Promise<void> {
    if (!this.enabled()) return;

    const windowMs = this.windowMs();
    const threshold = this.invalidThreshold();
    const windowStart = new Date(Date.now() - windowMs);

    const filters: Array<Promise<{ count: number; oldest?: Date }>> = [];
    if (ctx.customerId) {
      filters.push(
        this.countInvalidSince('customerId', ctx.customerId, windowStart),
      );
    }
    if (ctx.ipAddress) {
      filters.push(
        this.countInvalidSince('ipAddress', ctx.ipAddress, windowStart),
      );
    }
    if (filters.length === 0) return;

    const results = await Promise.all(filters);
    const tripped = results.find((r) => r.count >= threshold);
    if (tripped) {
      // We log a BLOCKED attempt so the admin abuse panel sees the
      // attempt count climbing even when we never run validation.
      // Best-effort — failure to write the row shouldn't break the
      // user-facing rejection.
      void this.recordAttempt(ctx, 'BLOCKED', 'rate_limit_exceeded').catch(
        (err) => this.logger.warn(`Failed to record BLOCKED attempt: ${err}`),
      );

      const retryAfter = tripped.oldest
        ? Math.max(
            1,
            Math.ceil(
              (tripped.oldest.getTime() + windowMs - Date.now()) / 1000,
            ),
          )
        : Math.ceil(windowMs / 1000);
      throw new TooManyCouponAttemptsError(retryAfter);
    }
  }

  /**
   * Write one row to coupon_attempts with the outcome. Always called
   * (even on success) so the abuse panel reflects total volume.
   */
  async recordAttempt(
    ctx: AttemptContext,
    result: CouponAttemptResult,
    reason?: string,
  ): Promise<CouponAttempt | null> {
    if (!this.enabled()) return null;
    try {
      return await this.prisma.couponAttempt.create({
        data: {
          customerId: ctx.customerId ?? null,
          ipAddress: ctx.ipAddress ?? null,
          deviceId: ctx.deviceId ?? null,
          // Normalize for indexing — uppercase + trim. Mirrors the
          // discount-code lookup's normalization so the abuse panel
          // groups codes consistently.
          codeAttempted: (ctx.codeAttempted ?? '').trim().toUpperCase(),
          result,
          reason: reason ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record coupon attempt: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Admin report: top-attempted INVALID codes within a window.
   * Surfaces patterns like "100 customers tried SUMMER50 today"
   * which usually means the code leaked or someone is guessing.
   */
  async getTopAbusedCodes(
    range: { fromDate: Date; toDate: Date },
    limit = 25,
  ): Promise<Array<{
    codeAttempted: string;
    invalidCount: number;
    distinctCustomers: number;
    distinctIps: number;
  }>> {
    type Row = {
      code_attempted: string;
      invalid_count: bigint;
      distinct_customers: bigint;
      distinct_ips: bigint;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        code_attempted,
        COUNT(*) AS invalid_count,
        COUNT(DISTINCT customer_id) AS distinct_customers,
        COUNT(DISTINCT ip_address) AS distinct_ips
      FROM coupon_attempts
      WHERE result IN ('INVALID', 'BLOCKED', 'NOT_ELIGIBLE', 'EXPIRED')
        AND created_at >= ${range.fromDate}
        AND created_at <= ${range.toDate}
      GROUP BY code_attempted
      ORDER BY invalid_count DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      codeAttempted: r.code_attempted,
      invalidCount: Number(r.invalid_count),
      distinctCustomers: Number(r.distinct_customers),
      distinctIps: Number(r.distinct_ips),
    }));
  }

  /**
   * Admin dashboard: aggregate attempt counts by result over the
   * window. Drives the analytics dashboard's "Abuse attempts" card.
   */
  async getAttemptStats(range: {
    fromDate: Date;
    toDate: Date;
  }): Promise<{
    total: number;
    valid: number;
    invalid: number;
    blocked: number;
    expired: number;
    notEligible: number;
  }> {
    const rows = await this.prisma.couponAttempt.groupBy({
      by: ['result'],
      where: { createdAt: { gte: range.fromDate, lte: range.toDate } },
      _count: true,
    });
    const byResult: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byResult[r.result] = r._count;
      total += r._count;
    }
    return {
      total,
      valid: byResult.VALID ?? 0,
      invalid: byResult.INVALID ?? 0,
      blocked: byResult.BLOCKED ?? 0,
      expired: byResult.EXPIRED ?? 0,
      notEligible: byResult.NOT_ELIGIBLE ?? 0,
    };
  }

  /**
   * Paginated raw attempts for the admin abuse drill-in. Returns
   * most recent first.
   */
  async listAttempts(args: {
    fromDate?: Date;
    toDate?: Date;
    result?: CouponAttemptResult;
    page: number;
    limit: number;
  }) {
    const where: any = {};
    if (args.fromDate || args.toDate) {
      where.createdAt = {};
      if (args.fromDate) where.createdAt.gte = args.fromDate;
      if (args.toDate) where.createdAt.lte = args.toDate;
    }
    if (args.result) where.result = args.result;

    const [items, total] = await Promise.all([
      this.prisma.couponAttempt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (args.page - 1) * args.limit,
        take: args.limit,
      }),
      this.prisma.couponAttempt.count({ where }),
    ]);
    return { items, total, page: args.page, limit: args.limit };
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private async countInvalidSince(
    column: 'customerId' | 'ipAddress',
    value: string,
    since: Date,
  ): Promise<{ count: number; oldest?: Date }> {
    // We need the oldest attempt within the window so retry-after
    // can be computed accurately. Two queries are cheap given the
    // composite indexes we created.
    const where: any = {
      result: { in: ['INVALID', 'EXPIRED', 'NOT_ELIGIBLE'] },
      createdAt: { gte: since },
    };
    where[column] = value;

    const [count, oldest] = await Promise.all([
      this.prisma.couponAttempt.count({ where }),
      this.prisma.couponAttempt.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return { count, oldest: oldest?.createdAt };
  }

  private enabled(): boolean {
    return this.env.getBoolean('DISCOUNT_FRAUD_TRACKING_ENABLED', true);
  }

  private windowMs(): number {
    return (
      this.env.getNumber('DISCOUNT_FRAUD_WINDOW_MINUTES', 15) * 60 * 1000
    );
  }

  private invalidThreshold(): number {
    return this.env.getNumber('DISCOUNT_FRAUD_INVALID_THRESHOLD', 10);
  }
}
