// Phase F (P2.3) — Affiliate ↔ Discount unification service.
//
// Routes affiliate-issued coupons through the unified discount pipeline
// while keeping the affiliate-specific metadata (commission %,
// attribution lifecycle) in the affiliate module.
//
// Two entry points:
//
//   unifyExistingCoupon(affiliateCouponCodeId)
//     - Migrates a legacy AffiliateCouponCode into the Discount table.
//       Creates a mirror Discount row carrying the same code, customer-
//       facing value, max-uses, min-order, and expiry, plus affiliateId
//       so the redemption hooks fire on checkout.
//     - Idempotent: returns the existing mirror if one is already linked.
//
//   onUnifiedCouponRedeemed(args)
//     - Called from DiscountReservationService.redeem when the Discount
//       row has affiliateId set. Attaches the ReferralAttribution and
//       lets the affiliate facade create the commission as usual. Keeps
//       AffiliateCouponCode.usedCount in sync so any legacy queries on
//       it still see real numbers.
//
// We deliberately keep the bridge thin — the affiliate module is
// still the source of truth for AffiliateCommission lifecycle.

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AffiliatePublicFacade } from '../../../affiliate/application/facades/affiliate-public.facade';

export interface UnifiedCouponRedeemedArgs {
  orderId: string;
  discountId: string;
  affiliateId: string;
  couponCode: string | null;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class DiscountAffiliateUnificationService {
  private readonly logger = new Logger(DiscountAffiliateUnificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly affiliate: AffiliatePublicFacade,
  ) {}

  /**
   * Promote an existing AffiliateCouponCode into the unified Discount
   * pipeline. Creates a mirror Discount with all the new-style fields
   * populated from the affiliate coupon's settings, then links the two
   * rows via AffiliateCouponCode.discountId.
   *
   * Returns the mirror Discount id either way (idempotent).
   */
  async unifyExistingCoupon(affiliateCouponCodeId: string): Promise<{ discountId: string }> {
    const couponCode = await this.prisma.affiliateCouponCode.findUnique({
      where: { id: affiliateCouponCodeId },
      include: {
        affiliate: { select: { id: true, status: true, commissionPercentage: true } },
      },
    });
    if (!couponCode) {
      throw new NotFoundException('Affiliate coupon code not found');
    }
    if (couponCode.discountId) {
      // Already unified — return the existing mirror.
      return { discountId: couponCode.discountId };
    }

    // Phase 158 (audit #8) — the unified Discount model has no
    // percentage-cap field (DiscountValueType is PERCENTAGE/FIXED_AMOUNT
    // only). Unifying a coupon that carries maxDiscountAmount would
    // SILENTLY drop the cap and re-expose the uncapped-percentage money
    // bug on the core discount path. Refuse loudly instead — the coupon
    // keeps running (correctly capped) on the affiliate path. Adding a
    // first-class cap to the core discounts pipeline is a separate,
    // larger change with its own checkout/reservation validation.
    if (couponCode.maxDiscountAmount != null) {
      throw new BadRequestException(
        'This coupon has a maximum-discount cap that the unified discount pipeline cannot yet represent. Unification is blocked so the cap is not silently lost.',
      );
    }

    // Translate customer-facing fields. AffiliateCouponCode uses
    // PERCENT/FIXED/FREE_SHIPPING; Discount uses PERCENTAGE/FIXED_AMOUNT
    // for the value and a separate `type` for the behaviour.
    let valueType: 'PERCENTAGE' | 'FIXED_AMOUNT' = 'PERCENTAGE';
    let value: number = 0;
    let discountType: 'AMOUNT_OFF_ORDER' | 'FREE_SHIPPING' = 'AMOUNT_OFF_ORDER';
    if (couponCode.customerDiscountType === 'FREE_SHIPPING') {
      // Phase 158 — carry FREE_SHIPPING across the bridge via type=FREE_SHIPPING
      // (the value is irrelevant; checkout zeros the shipping fee). Without this
      // the bridge silently downgraded a free-shipping code to a ₹0 amount-off
      // discount — the customer lost the waiver after unification.
      discountType = 'FREE_SHIPPING';
      valueType = 'PERCENTAGE';
      value = 0;
    } else if (couponCode.customerDiscountType && couponCode.customerDiscountValue != null) {
      valueType = couponCode.customerDiscountType === 'FIXED' ? 'FIXED_AMOUNT' : 'PERCENTAGE';
      value = Number(couponCode.customerDiscountValue);
    }

    // Affiliate coupons that don't carry a customer discount are still
    // valid — they exist purely for attribution. Mirror that by setting
    // value = 0 (the Discount row exists but the customer doesn't get
    // any reduction at checkout).
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.discount.create({
        data: {
          code: couponCode.code,
          title: 'Affiliate referral',
          type: discountType,
          method: 'CODE',
          valueType,
          value,
          appliesTo: 'ALL_PRODUCTS',
          minRequirement: couponCode.minOrderValue ? 'MIN_PURCHASE_AMOUNT' : 'NONE',
          minRequirementValue: couponCode.minOrderValue ?? null,
          maxUses: couponCode.maxUses ?? null,
          onePerCustomer: couponCode.perUserLimit === 1,
          combineProduct: false,
          combineOrder: false,
          combineShipping: false,
          startsAt: new Date(),
          endsAt: couponCode.expiresAt,
          status: couponCode.isActive ? 'ACTIVE' : 'DRAFT',
          // Funding stays PLATFORM by default; the affiliate commission
          // is a separate line, paid out of marketing budget.
          fundingType: 'PLATFORM',
          platformFundingPercent: 100,
          sellerFundingPercent: 0,
          brandFundingPercent: 0,
          commissionBasis: 'GROSS',
          discountNature: 'TRANSACTIONAL',
          // Phase F (P2.3) — the affiliate link itself.
          affiliateId: couponCode.affiliateId,
          affiliateCommissionPercent: couponCode.affiliate.commissionPercentage ?? null,
          // Seed usedCount so the migrated row reflects the historical
          // redemption count from the affiliate side.
          usedCount: couponCode.usedCount,
        },
      });
      await tx.affiliateCouponCode.update({
        where: { id: couponCode.id },
        data: { discountId: created.id },
      });
      return created.id;
    });

    this.logger.log(
      `Unified affiliate coupon ${affiliateCouponCodeId} → Discount ${result}`,
    );
    return { discountId: result };
  }

  /**
   * Bulk variant — migrate every AffiliateCouponCode that doesn't yet
   * have a mirror Discount. Used by the admin "Unify all" backfill.
   * Returns a summary the caller can show in the UI.
   */
  async unifyAllPending(): Promise<{
    total: number;
    unified: number;
    skipped: number;
    errors: Array<{ id: string; message: string }>;
  }> {
    const pending = await this.prisma.affiliateCouponCode.findMany({
      where: { discountId: null },
      select: { id: true },
    });
    let unified = 0;
    let skipped = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const row of pending) {
      try {
        await this.unifyExistingCoupon(row.id);
        unified++;
      } catch (e: any) {
        if (e instanceof BadRequestException) {
          skipped++;
        } else {
          errors.push({ id: row.id, message: e?.message ?? 'Unknown error' });
        }
      }
    }
    return { total: pending.length, unified, skipped, errors };
  }

  /**
   * Hook fired from the reservation service's redeem path when the
   * Discount carries an affiliateId. Two side-effects:
   *
   *   1. Write the ReferralAttribution row (idempotent on orderId).
   *      The downstream payment-confirmed handler will see this and
   *      create the AffiliateCommission via the usual facade flow.
   *   2. Bump AffiliateCouponCode.usedCount so the affiliate-side
   *      counter stays in sync with the discount-side usedCount.
   *
   * Best-effort: failures here MUST NOT roll back the redemption.
   */
  async onUnifiedCouponRedeemed(args: UnifiedCouponRedeemedArgs): Promise<void> {
    // Phase 67 (audit Gaps #13 + #14) — single attribution write
    // path. Pre-Phase-67 the checkout repo's placeOrderTransaction
    // and this hook BOTH wrote ReferralAttribution + incremented
    // AffiliateCouponCode.usedCount when a unified affiliate coupon
    // was used. The attribution row create is idempotent (P2002
    // catch), but the usedCount increment is not — every unified
    // redemption double-counted.
    //
    // Fix: if the checkout repo already wrote the attribution row
    // (we'd see it via findUnique on orderId, which the schema
    // declares unique), this hook becomes a no-op. The discount-
    // reservation-driven path remains the canonical writer for
    // legacy flows that don't carry attribution through the order tx.
    const client = args.tx ?? this.prisma;
    const existing = await client.referralAttribution.findUnique({
      where: { orderId: args.orderId },
      select: { id: true },
    }).catch(() => null);
    if (existing) {
      this.logger.debug(
        `onUnifiedCouponRedeemed: attribution already exists for order ${args.orderId} — repo path won; skipping`,
      );
      return;
    }

    // 1. Attribution row. The facade's attach method is itself
    //    idempotent on orderId, so duplicate calls are safe.
    try {
      if (args.tx) {
        await this.affiliate.attachAttributionToOrder(args.tx, {
          orderId: args.orderId,
          affiliateId: args.affiliateId,
          source: 'COUPON',
          code: args.couponCode,
        });
      } else {
        await this.prisma.$transaction(async (tx) => {
          await this.affiliate.attachAttributionToOrder(tx, {
            orderId: args.orderId,
            affiliateId: args.affiliateId,
            source: 'COUPON',
            code: args.couponCode,
          });
        });
      }
    } catch (e) {
      this.logger.warn(
        `attachAttributionToOrder failed for order ${args.orderId}: ${(e as Error).message}`,
      );
    }

    // 2. Keep the affiliate-side counter in sync. Used in admin
    //    dashboards and quota checks; failing this is non-fatal.
    //    Only reached when the repo path did NOT write the
    //    attribution row (legacy / non-affiliate-driven paths).
    if (args.couponCode) {
      try {
        const codeClient = args.tx ?? this.prisma;
        await codeClient.affiliateCouponCode.update({
          where: { code: args.couponCode },
          data: { usedCount: { increment: 1 } },
        });
      } catch (e) {
        this.logger.debug(
          `affiliate coupon usedCount sync failed for ${args.couponCode}: ${(e as Error).message}`,
        );
      }
    }
  }
}
