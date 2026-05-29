import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { attachReferralAttribution } from '../attach-referral-attribution';

/**
 * Cross-module surface area for the affiliate program. The
 * checkout / payment / refund modules call into this facade so they
 * never have to know about the affiliate domain internals.
 *
 * Contract:
 *   - `resolveAttribution` returns null when no eligible affiliate is
 *     attached. SRS §6.2 + §7.5: an INACTIVE / SUSPENDED / REJECTED
 *     affiliate's code or link is silently ignored — never an error.
 *     Phase 62 (audit Gap #1) also returns null when the placing
 *     customer IS the affiliate's bound User (self-referral fraud
 *     vector).
 *   - `attachAttributionToOrder` is meant to be called inside a Prisma
 *     transaction so the ReferralAttribution row commits atomically
 *     with the MasterOrder row.
 *   - `createCommissionForOrder` is idempotent (unique on orderId)
 *     and clamps to `AFFILIATE_COMMISSION_CAP_PER_ORDER` (audit
 *     Gap #14) so a single huge order can't bank unlimited earnings.
 */
@Injectable()
export class AffiliatePublicFacade {
  private readonly logger = new Logger(AffiliatePublicFacade.name);

  // Phase 159 — cache the platform default commission rate. Commission
  // creation fires on every paid affiliate-attributed order; without a
  // cache we'd hit AffiliateSettings on each. 5-min TTL means an ops
  // change to the default propagates within 5 minutes.
  private cachedDefaultRate: { value: Prisma.Decimal; expiresAt: number } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    // Phase 62 (2026-05-22) — env injected for the commission cap
    // (audit Gap #14). EnvService is global so no module wiring is
    // needed beyond declaring the constructor dep.
    private readonly env: EnvService,
  ) {}

  /**
   * Resolve a referral payload into an active affiliate, if any.
   * Per SRS §7.3 attribution priority: coupon > link.
   *
   * Phase 62 (2026-05-22) — also enforces the self-referral guard
   * (audit Gap #1) and uses case-insensitive code matching (audit
   * Gaps #19 + #27).
   *
   * Returns:
   *   { affiliateId, source, code } when the input maps to an ACTIVE
   *     affiliate AND the customer is not the affiliate themselves.
   *   null when nothing matches, the affiliate isn't earning, or
   *     self-referral would occur.
   */
  async resolveAttribution(input: {
    couponCode?: string | null;
    referralCode?: string | null;
    /**
     * Phase 62 — the customer placing the order. Required for the
     * self-referral guard (Gap #1). Old callers passing undefined
     * still work but get the pre-Phase-62 behaviour (no
     * self-referral check) — the checkout service is updated to
     * supply it; ad-hoc callers should follow suit.
     */
    customerId?: string | null;
  }): Promise<{
    affiliateId: string;
    source: 'LINK' | 'COUPON';
    code: string;
    // Phase 159c — FK to the originating coupon row, so the attribution can
    // be linked to the coupon (not just its string code).
    couponCodeId: string;
  } | null> {
    // Coupon wins over link per §7.3. Both checks resolve through the
    // same AffiliateCouponCode index. Phase 62 — canonicalize to
    // upper-case so a lower-case customer entry still matches.
    const candidates: Array<{ value: string; source: 'LINK' | 'COUPON' }> = [];
    if (input.couponCode?.trim()) {
      candidates.push({ value: input.couponCode.trim().toUpperCase(), source: 'COUPON' });
    }
    if (input.referralCode?.trim()) {
      candidates.push({ value: input.referralCode.trim().toUpperCase(), source: 'LINK' });
    }

    for (const { value, source } of candidates) {
      const code = await this.prisma.affiliateCouponCode.findUnique({
        where: { code: value },
        include: {
          // Phase 62 — affiliate.userId loaded so the self-referral
          // guard below can compare against the placing customer.
          affiliate: { select: { id: true, status: true, userId: true } },
        },
      });
      if (!code || !code.isActive) continue;
      if (code.expiresAt && code.expiresAt < new Date()) continue;
      // SRS §6.2 — only ACTIVE affiliates earn new commissions.
      if (code.affiliate.status !== 'ACTIVE') continue;
      // Phase F (P2.3) — unified coupons attribute via the discount
      // redemption hook instead of here. Skip COUPON-source rows that
      // have a mirror Discount so attribution isn't double-written.
      // LINK-source rows still use this path (no Discount equivalent).
      if (source === 'COUPON' && code.discountId) continue;

      // Phase 62 (2026-05-22) — self-referral guard (audit Gap #1).
      // An affiliate who is also a User can place orders via their
      // own code/link and bank commission — the single most damaging
      // fraud vector for the affiliate program. Reject silently so
      // the checkout completes normally (just without attribution),
      // matching the "silent fall-through" semantics SRS §7.5 uses
      // for INACTIVE/SUSPENDED affiliates.
      if (
        input.customerId &&
        code.affiliate.userId &&
        input.customerId === code.affiliate.userId
      ) {
        this.logger.warn(
          `Self-referral blocked: affiliate ${code.affiliate.id} (user=${code.affiliate.userId}) attempted to use own ${source} code "${code.code}" on own order`,
        );
        continue;
      }

      return {
        affiliateId: code.affiliate.id,
        source,
        code: code.code,
        couponCodeId: code.id,
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
   * Phase 62 (2026-05-22) — paise-rounded math to match the main
   * discounts service (audit Gap #7); upper-case canonicalization
   * for case-insensitive lookup (Gap #27).
   *
   * Phase 158 (2026-05-26) — FREE_SHIPPING is now supported end-to-end:
   * we surface valueType='FREE_SHIPPING' (discountAmount 0, the waiver is
   * applied at checkout), DiscountsService maps it to a FREE_SHIPPING coupon
   * type, and checkout zeroes shipping. PERCENT discounts are capped by
   * maxDiscountAmount (an uncapped "10% off" on a ₹2L order was the headline
   * money risk), and startsAt gates a future-dated campaign code.
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
    const code = (input.code || '').trim().toUpperCase();
    if (!code) return null;

    const couponCode = await this.prisma.affiliateCouponCode.findUnique({
      where: { code },
      include: { affiliate: { select: { id: true, status: true } } },
    });
    if (!couponCode) return null;

    // Phase F (P2.3) — if this coupon has already been unified into
    // the Discount table, return null so the upstream caller (DiscountsService.
    // validateCouponForCheckout) doesn't apply the affiliate-side fallback
    // on top of the regular Discount lookup it already did.
    if (couponCode.discountId) return null;

    if (!couponCode.isActive) {
      throw new Error('This affiliate code is currently inactive.');
    }
    if (couponCode.expiresAt && couponCode.expiresAt < new Date()) {
      throw new Error('This affiliate code has expired.');
    }
    // Phase 158 — scheduled-activation window (a future-dated campaign code).
    if (couponCode.startsAt && couponCode.startsAt > new Date()) {
      throw new Error('This affiliate code is not active yet.');
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
    if (couponCode.customerDiscountType === 'FREE_SHIPPING') {
      // Phase 158 — FREE_SHIPPING carries no subtotal discount; the shipping
      // waiver is applied downstream at checkout. We only signal the type;
      // discountAmount stays 0 so the subtotal is untouched here.
      valueType = 'FREE_SHIPPING';
      value = 0;
    } else if (
      couponCode.customerDiscountType &&
      couponCode.customerDiscountValue != null
    ) {
      valueType = couponCode.customerDiscountType;
      value = Number(couponCode.customerDiscountValue);
      // Phase 62 (audit Gap #22) — bounds. PERCENT must be 0-100;
      // FIXED must be non-negative. Out-of-bounds values would let
      // an admin issue a "150% off" code (customer gets paid 50%).
      // Reject hard instead of silently truncating.
      if (valueType === 'PERCENT' && (value < 0 || value > 100)) {
        throw new Error('Affiliate coupon misconfigured (percent out of range).');
      }
      if (valueType === 'FIXED' && value < 0) {
        throw new Error('Affiliate coupon misconfigured (fixed value negative).');
      }
      // Phase 62 — paise-rounded math (audit Gap #7) matches
      // discounts.service line 525-526 so the same code on cart
      // preview and checkout returns identical amounts. The old
      // Math.floor / Math.min mix produced whole-rupee floors that
      // diverged from the main path's 2dp rounding.
      if (valueType === 'PERCENT') {
        discountAmount = (subtotal * value) / 100;
        // Phase 158 (audit Critical #2) — cap a PERCENT discount by
        // maxDiscountAmount ("10% off, max ₹500"). An uncapped percentage
        // on a high-value order was the headline production money bug:
        // a "20% off" code on a ₹2,00,000 cart gave away ₹40,000.
        if (couponCode.maxDiscountAmount != null) {
          discountAmount = Math.min(
            discountAmount,
            Number(couponCode.maxDiscountAmount),
          );
        }
      } else if (valueType === 'FIXED') {
        discountAmount = value;
      }
      discountAmount = Math.max(0, Math.min(discountAmount, subtotal));
      discountAmount = Math.round(discountAmount * 100) / 100;
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
   *
   * Phase 62 (2026-05-22) — row-locked maxUses / perUserLimit
   * enforcement (audit Gaps #2 + #3). Pre-Phase-62 the maxUses
   * check ran outside any lock; two parallel checkouts both
   * passed the validate-time check and both incremented usedCount,
   * overshooting the cap. The new path:
   *   1. SELECT FOR UPDATE on the AffiliateCouponCode row.
   *   2. Re-check maxUses against current usedCount inside the lock.
   *   3. Re-check perUserLimit by counting prior ReferralAttribution
   *      rows for (code, affiliateId, customerId).
   *   4. Increment usedCount + insert the attribution row.
   * All inside the caller's tx, so a failure unwinds the order.
   */
  async attachAttributionToOrder(
    tx: Prisma.TransactionClient,
    input: {
      orderId: string;
      affiliateId: string;
      source: 'LINK' | 'COUPON';
      code: string | null;
      // Phase 62 — customerId required for the self-referral guard
      // backstop + perUserLimit query. Old callers without it skip
      // the perUserLimit check; the new checkout flow supplies it.
      customerId?: string | null;
      // Phase 159c — FK to the originating coupon row (optional).
      couponCodeId?: string | null;
    },
  ): Promise<void> {
    // Phase 159c — delegate to the shared helper. This logic used to be
    // duplicated in prisma-checkout.repository (audit M2); both call sites
    // now share one implementation (FOR UPDATE lock, maxUses + perUserLimit
    // re-check, usedCount increment, P2002-idempotent insert).
    await attachReferralAttribution(tx, input);
  }

  /**
   * Create the affiliate commission for an order (idempotent). Called
   * by the payment-confirmed event handler. Looks up the attribution
   * + per-affiliate or global commission rate, snapshots both, and
   * writes a PENDING AffiliateCommission row.
   *
   * Phase 62 (2026-05-22) — caps commissionAmount at
   * `AFFILIATE_COMMISSION_CAP_PER_ORDER` (audit Gap #14). Logs a
   * warning whenever the cap clamps a value so ops can spot
   * suspicious orders.
   *
   * If no attribution exists for the orderId, this is a no-op — the
   * order wasn't an affiliate-attributed order.
   */
  /**
   * Phase 159 (audit Critical #2) — the platform default commission rate,
   * read from AffiliateSettings (singleton) with a 5-min in-process cache.
   * Previously the fallback was a hardcoded Decimal(10), so an ops change
   * to AffiliateSettings.defaultCommissionPercentage was silently ignored.
   * Falls back to 10 only if the settings row is somehow absent.
   */
  private async getDefaultCommissionRate(): Promise<Prisma.Decimal> {
    const now = Date.now();
    if (this.cachedDefaultRate && now < this.cachedDefaultRate.expiresAt) {
      return this.cachedDefaultRate.value;
    }
    const settings = await this.prisma.affiliateSettings.findUnique({
      where: { id: 'singleton' },
      select: { defaultCommissionPercentage: true },
    });
    const value =
      settings?.defaultCommissionPercentage ?? new Prisma.Decimal(10);
    this.cachedDefaultRate = { value, expiresAt: now + 5 * 60_000 };
    return value;
  }

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
        id: true,
        affiliateId: true,
        source: true,
        code: true,
        // Phase 159d — carry the coupon FK onto the commission row.
        couponCodeId: true,
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

    // Affiliate-specific override → else the configured platform default
    // (Phase 159 — was a hardcoded Decimal(10); now reads AffiliateSettings).
    const rate =
      attribution.affiliate.commissionPercentage ??
      (await this.getDefaultCommissionRate());
    let amount = subtotal.times(rate).dividedBy(100).toDecimalPlaces(2);

    // Phase 62 (2026-05-22) — commission cap (audit Gap #14). Cap
    // is in paise so finance can dial it to ₹1000 (default) without
    // a code change. 0 disables the cap (back-compat for tests).
    const capPaise = this.env.getNumber('AFFILIATE_COMMISSION_CAP_PER_ORDER', 0);
    if (capPaise > 0) {
      const capRupees = new Prisma.Decimal(capPaise).dividedBy(100);
      if (amount.greaterThan(capRupees)) {
        this.logger.warn(
          `Affiliate commission cap clamp: order=${input.orderId} affiliate=${attribution.affiliateId} computed=${amount} cap=${capRupees}`,
        );
        amount = capRupees;
      }
    }

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
      // Phase 159d (audit M5) — atomic status-recheck + create. Re-reading the
      // affiliate status INSIDE the tx closes the (theoretical) race where the
      // affiliate is suspended between the top-of-method check and the insert.
      const created = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.affiliate.findUnique({
          where: { id: attribution.affiliateId },
          select: { status: true },
        });
        if (!fresh || fresh.status !== 'ACTIVE') return null;
        return tx.affiliateCommission.create({
          data: {
            orderId: input.orderId,
            affiliateId: attribution.affiliateId,
            source: attribution.source,
            code: attribution.code,
            // Phase 159d — explicit FKs (linkage was implicit via orderId).
            referralAttributionId: attribution.id,
            couponCodeId: attribution.couponCodeId ?? null,
            orderSubtotal: subtotal,
            commissionPercentage: rate,
            commissionAmount: amount,
            adjustedAmount: amount,
            status: 'PENDING',
            returnWindowEndsAt,
          },
          select: { id: true },
        });
      });
      if (!created) {
        this.logger.warn(
          `Skipping commission for order ${input.orderId} — affiliate ${attribution.affiliateId} no longer ACTIVE at create time`,
        );
        return null;
      }
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
    // Phase 159c — flip the attribution row to REVERSED so attribution-level
    // consumers (reports, fraud) see the order no longer credits the affiliate.
    // Done first + unconditionally: an order cancelled BEFORE payment has an
    // attribution row but no commission yet, so this must not depend on the
    // commission existing. Best-effort (updateMany → 0 rows if none).
    await this.prisma.referralAttribution
      .updateMany({
        where: { orderId, status: { not: 'REVERSED' } },
        data: { status: 'REVERSED' },
      })
      .catch((err) =>
        this.logger.warn(
          `Failed to mark attribution REVERSED for order ${orderId}: ${(err as Error).message}`,
        ),
      );

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

    const updated = await this.prisma.affiliateCommission.update({
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

    // Phase 2 / C2 — broadcast the REVERSED transition so settlements
    // can issue an offsetting ledger row, notifications can tell the
    // affiliate "your earnings were reversed", and audit gets a trail.
    // CANCELLED (pre-PAID) doesn't need an event today — no money
    // was settled, no downstream needs to react beyond the local
    // update. A future PR can add `affiliate.commission.cancelled`
    // if a real consumer surfaces.
    if (target === 'REVERSED') {
      await this.eventBus
        .publish({
          eventName: 'affiliate.commission.reversed',
          aggregate: 'AffiliateCommission',
          aggregateId: c.id,
          occurredAt: new Date(),
          payload: {
            commissionId: c.id,
            affiliateId: updated.affiliateId,
            orderId,
            reason,
          },
        })
        .catch((err) => {
          this.logger.warn(
            `Failed to publish affiliate.commission.reversed for ${c.id}: ${(err as Error).message}`,
          );
        });
    }
  }
}
