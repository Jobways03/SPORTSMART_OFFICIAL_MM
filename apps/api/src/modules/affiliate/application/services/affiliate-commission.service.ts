import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

/**
 * SRS §8 + §9 — affiliate commission lifecycle. State machine:
 *
 *   PENDING ──▶ HOLD          (exchange initiated)
 *           ──▶ CONFIRMED     (return window expired without return)
 *           ──▶ CANCELLED     (refund/return before completion)
 *   HOLD    ──▶ PENDING       (exchange resolved, amount must not increase)
 *   CONFIRMED ──▶ CANCELLED   (refund/return after completion, before payout)
 *             ──▶ PAID         (payout processed)
 *   PAID    ──▶ REVERSED      (refund/return after payout)
 *
 * CANCELLED + REVERSED are terminal. HOLD overrides everything else
 * — it cannot be confirmed or paid.
 *
 * Methods are intentionally service-only (no controller). Order
 * lifecycle hooks call these from event handlers in the next phase.
 */
@Injectable()
export class AffiliateCommissionService {
  private readonly logger = new Logger(AffiliateCommissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a PENDING commission for an affiliate-attributed order.
   * Idempotent — the unique constraint on orderId means a duplicate
   * webhook delivery returns the existing row instead of erroring.
   */
  async createForOrder(input: {
    orderId: string;
    affiliateId: string;
    source: 'LINK' | 'COUPON';
    code?: string | null;
    orderSubtotal: number | string;
    commissionPercentage: number | string;
    returnWindowEndsAt?: Date;
  }) {
    const subtotal = new Prisma.Decimal(input.orderSubtotal);
    const rate = new Prisma.Decimal(input.commissionPercentage);
    // SRS §8.1 — commission base is the post-discount order subtotal.
    // The caller is responsible for passing the correct base; we just
    // compute the rate against it. Round to 2dp at the boundary so
    // adjustedAmount stays consistent with downstream payout sums.
    const amount = subtotal.times(rate).dividedBy(100).toDecimalPlaces(2);

    try {
      return await this.prisma.affiliateCommission.create({
        data: {
          orderId: input.orderId,
          affiliateId: input.affiliateId,
          source: input.source,
          code: input.code ?? null,
          orderSubtotal: subtotal,
          commissionPercentage: rate,
          commissionAmount: amount,
          adjustedAmount: amount,
          status: 'PENDING',
          returnWindowEndsAt: input.returnWindowEndsAt ?? null,
        },
      });
    } catch (err: any) {
      // P2002 = unique violation on orderId. Idempotent retry — return
      // the existing commission rather than failing the webhook.
      if (err?.code === 'P2002') {
        const existing = await this.prisma.affiliateCommission.findUnique({
          where: { orderId: input.orderId },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * SRS §11.2 — return window has expired without a return. Cron job
   * calls this for every PENDING commission whose returnWindowEndsAt
   * has passed.
   *
   * HOLD commissions are ignored — the §3 HOLD-overrides rule.
   */
  async confirm(commissionId: string) {
    const c = await this.requireById(commissionId);
    if (c.status === 'CONFIRMED') return c;
    if (c.status !== 'PENDING') {
      throw new BadRequestAppException(
        `Cannot confirm a commission in ${c.status} state`,
      );
    }
    return this.prisma.affiliateCommission.update({
      where: { id: commissionId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
  }

  /**
   * SRS §12.1 + §12.2 — refund/return killed the commission before
   * payout. Allowed from PENDING / CONFIRMED / HOLD. Terminal.
   */
  async cancel(commissionId: string, reason?: string) {
    const c = await this.requireById(commissionId);
    if (c.status === 'CANCELLED') return c;
    if (!['PENDING', 'CONFIRMED', 'HOLD'].includes(c.status)) {
      throw new BadRequestAppException(
        `Cannot cancel a commission in ${c.status} state — already paid or reversed`,
      );
    }
    return this.prisma.affiliateCommission.update({
      where: { id: commissionId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        notes: reason
          ? c.notes
            ? `${c.notes}\n[cancelled] ${reason}`
            : `[cancelled] ${reason}`
          : c.notes,
      },
    });
  }

  /**
   * SRS §12.3 — refund AFTER payout. The commission was already paid;
   * we record a REVERSED row so the affiliate's negative balance can
   * be deducted from their next payout (handled by payout service).
   */
  async reverse(commissionId: string, reason?: string) {
    const c = await this.requireById(commissionId);
    if (c.status === 'REVERSED') return c;
    if (c.status !== 'PAID') {
      throw new BadRequestAppException(
        `Cannot reverse a commission in ${c.status} state — only PAID commissions can be reversed`,
      );
    }
    return this.prisma.affiliateCommission.update({
      where: { id: commissionId },
      data: {
        status: 'REVERSED',
        reversedAt: new Date(),
        notes: reason
          ? c.notes
            ? `${c.notes}\n[reversed] ${reason}`
            : `[reversed] ${reason}`
          : c.notes,
      },
    });
  }

  /**
   * SRS §13.1 — exchange initiated. Pause the commission until the
   * exchange resolves. HOLD overrides everything else; this method
   * accepts PENDING and CONFIRMED as starting states.
   */
  async hold(commissionId: string, reason?: string) {
    const c = await this.requireById(commissionId);
    if (c.status === 'HOLD') return c;
    if (!['PENDING', 'CONFIRMED'].includes(c.status)) {
      throw new BadRequestAppException(
        `Cannot put a commission on hold from ${c.status} state`,
      );
    }
    return this.prisma.affiliateCommission.update({
      where: { id: commissionId },
      data: { status: 'HOLD', holdReason: reason ?? null },
    });
  }

  /**
   * SRS §13.3 — exchange completed. Commission goes back to PENDING
   * and the return-window cron resumes. Caller MUST verify the new
   * order value isn't higher than the original; if it's lower, also
   * call applyAdjustment with the partial-refund delta first.
   */
  async resumeFromHold(commissionId: string) {
    const c = await this.requireById(commissionId);
    if (c.status !== 'HOLD') {
      throw new BadRequestAppException(
        `Cannot resume from HOLD — current state is ${c.status}`,
      );
    }
    return this.prisma.affiliateCommission.update({
      where: { id: commissionId },
      data: { status: 'PENDING', holdReason: null },
    });
  }

  /**
   * SRS §8.4 — partial refund / exchange resolution / manual admin
   * tweak. Applies a delta (negative = reduction) and logs an
   * immutable adjustment row. The commission's adjustedAmount is the
   * value used for payout; commissionAmount stays as the original
   * snapshot for audit.
   */
  async applyAdjustment(input: {
    commissionId: string;
    deltaAmount: number | string;
    kind: 'PARTIAL_REFUND' | 'EXCHANGE_RESOLVE' | 'MANUAL_ADJUST';
    reason?: string;
    actorId?: string;
  }) {
    const c = await this.requireById(input.commissionId);
    const before = c.adjustedAmount;
    const delta = new Prisma.Decimal(input.deltaAmount);
    const after = before.plus(delta);

    if (after.lessThan(0)) {
      throw new BadRequestAppException(
        'Adjustment would push commission below zero. Use cancel/reverse instead.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.affiliateCommissionAdjustment.create({
        data: {
          commissionId: input.commissionId,
          kind: input.kind,
          deltaAmount: delta,
          beforeAmount: before,
          afterAmount: after,
          reason: input.reason ?? null,
          actorId: input.actorId ?? null,
        },
      });
      return tx.affiliateCommission.update({
        where: { id: input.commissionId },
        data: { adjustedAmount: after },
      });
    });
  }

  /** Mark a commission as PAID — called by the payout service after
   *  the bank transfer settles. Sets paidAt + payoutRequestId. */
  async markPaid(commissionId: string, payoutRequestId: string) {
    const c = await this.requireById(commissionId);
    if (c.status !== 'CONFIRMED') {
      throw new BadRequestAppException(
        `Cannot mark paid — commission is in ${c.status} state, must be CONFIRMED`,
      );
    }
    return this.prisma.affiliateCommission.update({
      where: { id: commissionId },
      data: { status: 'PAID', paidAt: new Date(), payoutRequestId },
    });
  }

  // ── Reader methods (used by dashboard endpoints) ─────────────

  async listForAffiliate(
    affiliateId: string,
    params: { page?: number; limit?: number; status?: string },
  ) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));

    const where: any = { affiliateId };
    if (params.status) where.status = params.status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.affiliateCommission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.affiliateCommission.count({ where }),
    ]);

    return {
      commissions: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Admin-side commission browser. Same shape as listForAffiliate but
   * with optional cross-affiliate filters and the affiliate name
   * joined in for display. Status/source filters are pass-through.
   */
  async listForAdmin(params: {
    page?: number;
    limit?: number;
    status?: string;
    source?: 'LINK' | 'COUPON';
    affiliateId?: string;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.source) where.source = params.source;
    if (params.affiliateId) where.affiliateId = params.affiliateId;
    if (params.search) {
      const q = params.search.trim();
      if (q) {
        where.OR = [
          { code: { contains: q, mode: 'insensitive' } },
          { orderId: { contains: q, mode: 'insensitive' } },
          { affiliate: { email: { contains: q, mode: 'insensitive' } } },
          { affiliate: { firstName: { contains: q, mode: 'insensitive' } } },
          { affiliate: { lastName: { contains: q, mode: 'insensitive' } } },
        ];
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.affiliateCommission.findMany({
        where,
        include: {
          affiliate: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.affiliateCommission.count({ where }),
    ]);

    return {
      commissions: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Aggregate totals across the platform — for the admin overview tiles. */
  async getAdminTotals() {
    const grouped = await this.prisma.affiliateCommission.groupBy({
      by: ['status'],
      _sum: { adjustedAmount: true },
      _count: { _all: true },
    });
    const empty = { sum: '0', count: 0 };
    const totals: Record<string, { sum: string; count: number }> = {
      PENDING: { ...empty },
      HOLD: { ...empty },
      CONFIRMED: { ...empty },
      PAID: { ...empty },
      CANCELLED: { ...empty },
      REVERSED: { ...empty },
    };
    for (const row of grouped) {
      totals[row.status] = {
        sum: (row._sum.adjustedAmount ?? 0).toString(),
        count: row._count._all,
      };
    }
    return totals;
  }

  /** Sum aggregates by status — used for the affiliate dashboard's
   *  Pending / Confirmed / Paid headline numbers. */
  async getBalances(affiliateId: string) {
    const grouped = await this.prisma.affiliateCommission.groupBy({
      by: ['status'],
      where: { affiliateId },
      _sum: { adjustedAmount: true },
      _count: { _all: true },
    });

    const out: Record<string, string> = {
      pending: '0',
      hold: '0',
      confirmed: '0',
      paid: '0',
      cancelled: '0',
      reversed: '0',
    };
    const counts: Record<string, number> = {
      pending: 0,
      hold: 0,
      confirmed: 0,
      paid: 0,
      cancelled: 0,
      reversed: 0,
    };
    for (const row of grouped) {
      const key = row.status.toLowerCase();
      out[key] = (row._sum.adjustedAmount ?? new Prisma.Decimal(0)).toString();
      counts[key] = row._count._all;
    }

    return { ...out, counts };
  }

  // ── Internals ───────────────────────────────────────────────

  private async requireById(commissionId: string) {
    const c = await this.prisma.affiliateCommission.findUnique({
      where: { id: commissionId },
    });
    if (!c) throw new NotFoundAppException('Commission not found');
    return c;
  }
}
