import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Cross-module surface area for the affiliate program. The
 * checkout / payment / refund modules call into this facade so they
 * never have to know about the affiliate domain internals.
 *
 * Contract:
 *   - `resolveAttribution` returns null when no eligible affiliate is
 *     attached. SRS §6.2 + §7.5: an INACTIVE / SUSPENDED / REJECTED
 *     affiliate's code or link is silently ignored — never an error.
 *   - `attachAttributionToOrder` is meant to be called inside a Prisma
 *     transaction so the ReferralAttribution row commits atomically
 *     with the MasterOrder row.
 *   - `createCommissionForOrder` is idempotent (unique on orderId).
 */
@Injectable()
export class AffiliatePublicFacade {
  private readonly logger = new Logger(AffiliatePublicFacade.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a referral payload into an active affiliate, if any.
   * Per SRS §7.3 attribution priority: coupon > link.
   *
   * Returns:
   *   { affiliateId, source, code } when the input maps to an ACTIVE
   *     affiliate (PENDING / INACTIVE / SUSPENDED / REJECTED → null).
   *   null when nothing matches or the affiliate isn't earning.
   */
  async resolveAttribution(input: {
    couponCode?: string | null;
    referralCode?: string | null;
  }): Promise<{
    affiliateId: string;
    source: 'LINK' | 'COUPON';
    code: string;
  } | null> {
    // Coupon wins over link per §7.3. Both checks resolve through the
    // same AffiliateCouponCode index.
    const candidates: Array<{ value: string; source: 'LINK' | 'COUPON' }> = [];
    if (input.couponCode?.trim()) {
      candidates.push({ value: input.couponCode.trim(), source: 'COUPON' });
    }
    if (input.referralCode?.trim()) {
      candidates.push({ value: input.referralCode.trim(), source: 'LINK' });
    }

    for (const { value, source } of candidates) {
      const code = await this.prisma.affiliateCouponCode.findUnique({
        where: { code: value },
        include: {
          affiliate: { select: { id: true, status: true } },
        },
      });
      if (!code || !code.isActive) continue;
      if (code.expiresAt && code.expiresAt < new Date()) continue;
      // SRS §6.2 — only ACTIVE affiliates earn new commissions.
      if (code.affiliate.status !== 'ACTIVE') continue;

      return {
        affiliateId: code.affiliate.id,
        source,
        code: code.code,
      };
    }

    return null;
  }

  /**
   * Customer-side coupon validation for the storefront checkout.
   * Returns a discount-shaped payload when the code is a live
   * affiliate coupon — letting the regular DiscountsService fall
   * through to us for codes its own table doesn't recognise.
   *
   * Returns null for "not an affiliate coupon" (so the caller can
   * surface the regular "invalid coupon" error). Throws when the
   * code IS ours but the order doesn't meet a constraint (min order
   * value, exhausted, expired) — the message is what the customer
   * sees.
   *
   * Customer discount is optional: if the affiliate hasn't
   * configured `customerDiscountType` / `customerDiscountValue`,
   * the coupon resolves with discountAmount=0 — the customer pays
   * full price but the order still attributes to the affiliate
   * for commission.
   */
  async validateAffiliateCouponForCustomer(input: {
    code: string;
    subtotal: number;
  }): Promise<{
    discountId: string;
    code: string;
    title: string | null;
    valueType: string;
    value: number;
    discountAmount: number;
  } | null> {
    const code = (input.code || '').trim();
    if (!code) return null;

    const couponCode = await this.prisma.affiliateCouponCode.findUnique({
      where: { code },
      include: { affiliate: { select: { id: true, status: true } } },
    });
    if (!couponCode) return null;

    if (!couponCode.isActive) {
      throw new Error('This affiliate code is currently inactive.');
    }
    if (couponCode.expiresAt && couponCode.expiresAt < new Date()) {
      throw new Error('This affiliate code has expired.');
    }
    if (
      couponCode.maxUses != null &&
      couponCode.usedCount >= couponCode.maxUses
    ) {
      throw new Error('This affiliate code has reached its usage limit.');
    }
    if (couponCode.affiliate.status !== 'ACTIVE') {
      // SRS §6.2 — only ACTIVE affiliates earn new commissions, so
      // surface the same "invalid" UX for inactive partners.
      return null;
    }

    const subtotal = Number(input.subtotal || 0);
    if (
      couponCode.minOrderValue &&
      subtotal < Number(couponCode.minOrderValue)
    ) {
      throw new Error(
        `This code needs a minimum order of ₹${Number(couponCode.minOrderValue).toLocaleString('en-IN')}.`,
      );
    }

    let valueType: string = 'NONE';
    let value = 0;
    let discountAmount = 0;
    if (
      couponCode.customerDiscountType &&
      couponCode.customerDiscountValue != null
    ) {
      valueType = couponCode.customerDiscountType;
      value = Number(couponCode.customerDiscountValue);
      if (valueType === 'PERCENT') {
        discountAmount = Math.floor((subtotal * value) / 100);
      } else if (valueType === 'FIXED') {
        discountAmount = Math.min(value, subtotal);
      }
    }

    return {
      // Synthesized id — distinguishes affiliate-sourced rows from
      // real Discount rows for any downstream auditing.
      discountId: `affiliate:${couponCode.id}`,
      code: couponCode.code,
      title: 'Affiliate referral',
      valueType,
      value,
      discountAmount,
    };
  }

  /**
   * Persist the affiliate-to-order binding. Call this inside the
   * order-creation transaction so it commits or rolls back together.
   * Idempotent on orderId — a duplicate call is a no-op.
   */
  async attachAttributionToOrder(
    tx: Prisma.TransactionClient,
    input: {
      orderId: string;
      affiliateId: string;
      source: 'LINK' | 'COUPON';
      code: string | null;
    },
  ): Promise<void> {
    try {
      await tx.referralAttribution.create({
        data: {
          orderId: input.orderId,
          affiliateId: input.affiliateId,
          source: input.source,
          code: input.code,
        },
      });
    } catch (err: any) {
      // Idempotent: if a row already exists for this order (retry,
      // duplicate webhook), don't fail the order creation.
      if (err?.code !== 'P2002') throw err;
    }

    // Bump the coupon-code usage counter (best-effort — failure here
    // shouldn't break the order). Only meaningful for COUPON source.
    if (input.source === 'COUPON' && input.code) {
      await tx.affiliateCouponCode
        .update({
          where: { code: input.code },
          data: { usedCount: { increment: 1 } },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Create the affiliate commission for an order (idempotent). Called
   * by the payment-confirmed event handler. Looks up the attribution
   * + per-affiliate or global commission rate, snapshots both, and
   * writes a PENDING AffiliateCommission row.
   *
   * If no attribution exists for the orderId, this is a no-op — the
   * order wasn't an affiliate-attributed order.
   */
  async createCommissionForOrder(input: {
    orderId: string;
    /**
     * The post-discount order subtotal (SRS §8.1) — what commission
     * is calculated on. We DON'T derive this here because the order
     * record carries `totalAmount` which is post-discount and
     * pre-tax/shipping at this stage.
     */
    orderSubtotal?: number | string;
    /** When the return window closes. Set by the delivered-event
     *  handler if not provided here. */
    returnWindowEndsAt?: Date;
  }): Promise<{ commissionId: string } | null> {
    const attribution = await this.prisma.referralAttribution.findUnique({
      where: { orderId: input.orderId },
      select: {
        affiliateId: true,
        source: true,
        code: true,
        affiliate: {
          select: { id: true, status: true, commissionPercentage: true },
        },
      },
    });
    if (!attribution) return null;

    // Defensive: re-check the affiliate's eligibility at commission-
    // creation time. An affiliate who placed an order via their link
    // and got SUSPENDED before payment should NOT earn from it
    // (§6.2 — admin actions take effect immediately).
    if (attribution.affiliate.status !== 'ACTIVE') {
      this.logger.warn(
        `Skipping commission for order ${input.orderId} — affiliate ${attribution.affiliateId} is ${attribution.affiliate.status}`,
      );
      return null;
    }

    // Resolve subtotal: prefer caller-provided, else read from order.
    let subtotal: Prisma.Decimal;
    if (input.orderSubtotal !== undefined) {
      subtotal = new Prisma.Decimal(input.orderSubtotal);
    } else {
      const order = await this.prisma.masterOrder.findUnique({
        where: { id: input.orderId },
        select: { totalAmount: true, discountAmount: true },
      });
      if (!order) return null;
      // totalAmount is already post-discount in the checkout repo.
      subtotal = new Prisma.Decimal(order.totalAmount);
    }

    // Affiliate-specific override → fallback to a global default.
    // TODO: source the default from CommissionSetting once an
    // affiliate-percent column is added there. For now: 10% per SRS
    // §26 default.
    const rate =
      attribution.affiliate.commissionPercentage ?? new Prisma.Decimal(10);
    const amount = subtotal.times(rate).dividedBy(100).toDecimalPlaces(2);

    // Resolve return-window backstop. The `delivered` and `captured`
    // events can fire in either order; if delivered fires first, the
    // setReturnWindowForOrder updateMany matches 0 rows because this
    // row doesn't exist yet, and the timestamp is lost. We re-derive
    // it here from the sub-orders so the cron can confirm correctly
    // regardless of event ordering.
    let returnWindowEndsAt: Date | null = input.returnWindowEndsAt ?? null;
    if (!returnWindowEndsAt) {
      const subs = await this.prisma.subOrder.findMany({
        where: { masterOrderId: input.orderId },
        select: { returnWindowEndsAt: true },
      });
      const windows = subs
        .map((s) => s.returnWindowEndsAt)
        .filter((d): d is Date => !!d);
      if (windows.length > 0) {
        // Latest sub-order window — multi-sub orders confirm only when
        // every sub-order's window has closed.
        returnWindowEndsAt = new Date(
          Math.max(...windows.map((d) => d.getTime())),
        );
      }
    }

    try {
      const created = await this.prisma.affiliateCommission.create({
        data: {
          orderId: input.orderId,
          affiliateId: attribution.affiliateId,
          source: attribution.source,
          code: attribution.code,
          orderSubtotal: subtotal,
          commissionPercentage: rate,
          commissionAmount: amount,
          adjustedAmount: amount,
          status: 'PENDING',
          returnWindowEndsAt,
        },
        select: { id: true },
      });
      this.logger.log(
        `Affiliate commission created: order=${input.orderId} affiliate=${attribution.affiliateId} amount=${amount}`,
      );
      return { commissionId: created.id };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Duplicate webhook — return existing commission.
        const existing = await this.prisma.affiliateCommission.findUnique({
          where: { orderId: input.orderId },
          select: { id: true },
        });
        return existing ? { commissionId: existing.id } : null;
      }
      throw err;
    }
  }

  /**
   * Apply the return-window timestamp to an existing commission.
   * Called when the sub-order is delivered. Idempotent.
   */
  async setReturnWindowForOrder(orderId: string, endsAt: Date): Promise<void> {
    await this.prisma.affiliateCommission
      .updateMany({
        where: { orderId, returnWindowEndsAt: null, status: 'PENDING' },
        data: { returnWindowEndsAt: endsAt },
      })
      .catch(() => undefined);
  }

  /**
   * Cancel-or-reverse helper for the refund/cancellation paths.
   * Picks the correct terminal state based on current status:
   *   PENDING / CONFIRMED / HOLD → CANCELLED
   *   PAID                       → REVERSED
   * Already-terminal states → no-op.
   */
  async cancelOrReverseForOrder(orderId: string, reason: string): Promise<void> {
    const c = await this.prisma.affiliateCommission.findUnique({
      where: { orderId },
      select: { id: true, status: true, notes: true },
    });
    if (!c) return;
    if (['CANCELLED', 'REVERSED'].includes(c.status)) return;

    const target = c.status === 'PAID' ? 'REVERSED' : 'CANCELLED';
    const note = c.notes
      ? `${c.notes}\n[${target.toLowerCase()}] ${reason}`
      : `[${target.toLowerCase()}] ${reason}`;

    await this.prisma.affiliateCommission.update({
      where: { id: c.id },
      data: {
        status: target,
        notes: note,
        ...(target === 'CANCELLED'
          ? { cancelledAt: new Date() }
          : { reversedAt: new Date() }),
      },
    });
    this.logger.log(
      `Affiliate commission ${c.id} (order ${orderId}) → ${target}: ${reason}`,
    );
  }

  // ── Legacy stubs kept for callers we haven't migrated yet ─────

  async recordReferralEvent(referralData: {
    affiliateId: string;
    referralId: string;
    eventType: string;
    orderId?: string;
    customerId?: string;
  }): Promise<void> {
    this.logger.log(
      `Referral event: ${referralData.eventType} for affiliate ${referralData.affiliateId}`,
    );
  }

  async reverseCommissionEligibility(
    orderId: string,
    reason: string,
  ): Promise<void> {
    return this.cancelOrReverseForOrder(orderId, reason);
  }
}
