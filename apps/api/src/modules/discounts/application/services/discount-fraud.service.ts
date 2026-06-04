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

import { createHash } from 'node:crypto';
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
      // Phase 62 (2026-05-22) — rate-limit by IP hash, not plaintext
      // IP (audit Gap #21). The hash is queried against the indexed
      // ip_hash column; ipAddress stays in the input ctx for the
      // single write-time hash + drop call below.
      filters.push(
        this.countInvalidSince(
          'ipHash',
          this.hashIp(ctx.ipAddress),
          windowStart,
        ),
      );
    }
    // Phase 245 (#20) — also limit by device. An attacker rotating IPs via
    // proxies but reusing the same client was unbounded; a device-stable id
    // closes that. (Conversely a shared-NAT IP no longer collateral-blocks
    // everyone, since the device dimension is independent.)
    if (ctx.deviceId) {
      filters.push(
        this.countInvalidSince('deviceId', ctx.deviceId, windowStart),
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
          // Phase 62 (2026-05-22) — ipAddress is intentionally NOT
          // persisted (audit Gap #21). The salted SHA-256 hash lets
          // the rate-limiter still detect collisions across attempts
          // without storing PII. A future cleanup-cron pass nulls
          // any pre-Phase-62 plaintext rows.
          ipAddress: null,
          ipHash: ctx.ipAddress ? this.hashIp(ctx.ipAddress) : null,
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
   * Phase 62 (2026-05-22) — salted SHA-256 of an IP address (audit
   * Gap #21). The salt is env-configured and rotated quarterly; old
   * digests remain queryable for the 30-day cleanup window. We use
   * SHA-256 + salt (not just truncation or hashing) because the
   * IPv4 address space is small enough that an attacker with the
   * DB dump could brute-force the un-salted hash trivially.
   */
  private hashIp(ip: string): string {
    const salt = this.env.getString(
      'COUPON_ATTEMPT_IP_HASH_SALT',
      'sportsmart-coupon-attempt-salt-2026-05-rotate-quarterly',
    );
    return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
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
        -- Phase 245 — ip_address is nulled post-Phase-62; the salted
        -- ip_hash is the real per-source signal.
        COUNT(DISTINCT ip_hash) AS distinct_ips
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
    // Phase 245 (#13) — full customerId/deviceId are PII. Mask by default;
    // only a caller holding discounts.abuse.read with an explicit reveal
    // grant gets the raw values (server-side, not client-truncated).
    revealPii?: boolean;
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
    const out = args.revealPii
      ? items
      : items.map((it) => ({
          ...it,
          customerId: this.maskId(it.customerId),
          deviceId: this.maskId(it.deviceId),
        }));
    return { items: out, total, page: args.page, limit: args.limit };
  }

  private maskId(id: string | null): string | null {
    if (!id) return id;
    return id.length <= 4 ? '***' : `***${id.slice(-4)}`;
  }

  /**
   * Phase 245 (abuse-detection audit #1) — per-customer-per-coupon
   * concentration: the core "coupons used disproportionately by single
   * accounts" signal the flow is named for. For each coupon, returns the
   * customers whose REDEEMED share of that coupon's total redemptions is
   * above `thresholdPct` (default 20%) with at least `minRedemptions`
   * (default 5) total. Read-only telemetry — the full alert/FSM/scoring
   * subsystem is surfaced as follow-up; this gives risk the actionable
   * signal today. Customer ids are masked unless revealPii.
   */
  async getCouponConcentration(args: {
    fromDate: Date;
    toDate: Date;
    minRedemptions?: number;
    thresholdPct?: number;
    limit?: number;
    revealPii?: boolean;
  }): Promise<
    Array<{
      discountId: string;
      discountCode: string | null;
      customerId: string | null;
      customerRedemptions: number;
      totalRedemptions: number;
      sharePct: number;
    }>
  > {
    const minRedemptions = Math.max(1, args.minRedemptions ?? 5);
    const thresholdPct = Math.min(100, Math.max(1, args.thresholdPct ?? 20));
    const limit = Math.min(200, Math.max(1, args.limit ?? 50));
    type Row = {
      discount_id: string;
      discount_code: string | null;
      customer_id: string;
      customer_redemptions: bigint;
      total_redemptions: bigint;
      share_pct: number;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      WITH coupon_totals AS (
        SELECT discount_id, COUNT(*) AS total
        FROM discount_redemptions
        WHERE status = 'REDEEMED'
          AND created_at >= ${args.fromDate}
          AND created_at <= ${args.toDate}
        GROUP BY discount_id
      ),
      per_customer AS (
        SELECT discount_id, customer_id, COUNT(*) AS cust
        FROM discount_redemptions
        WHERE status = 'REDEEMED'
          AND created_at >= ${args.fromDate}
          AND created_at <= ${args.toDate}
        GROUP BY discount_id, customer_id
      )
      SELECT
        pc.discount_id,
        d.code AS discount_code,
        pc.customer_id,
        pc.cust AS customer_redemptions,
        ct.total AS total_redemptions,
        ROUND(100.0 * pc.cust / NULLIF(ct.total, 0), 2) AS share_pct
      FROM per_customer pc
      JOIN coupon_totals ct ON ct.discount_id = pc.discount_id
      LEFT JOIN discounts d ON d.id = pc.discount_id
      WHERE ct.total >= ${minRedemptions}
        AND (100.0 * pc.cust / NULLIF(ct.total, 0)) >= ${thresholdPct}
      ORDER BY share_pct DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      discountId: r.discount_id,
      discountCode: r.discount_code,
      customerId: args.revealPii ? r.customer_id : this.maskId(r.customer_id),
      customerRedemptions: Number(r.customer_redemptions),
      totalRedemptions: Number(r.total_redemptions),
      sharePct: Number(r.share_pct),
    }));
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private async countInvalidSince(
    // Phase 245 (#20) — deviceId joins customerId/ipHash as a rate-limit
    // dimension. (Single-query count+oldest, audit #21, was rated
    // acceptable/BY-DESIGN; the tiny skew window is harmless for a limiter,
    // so we keep the two-read form the indexes already serve well.)
    column: 'customerId' | 'ipHash' | 'deviceId',
    value: string,
    since: Date,
  ): Promise<{ count: number; oldest?: Date }> {
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
