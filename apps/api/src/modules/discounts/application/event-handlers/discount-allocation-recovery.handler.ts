import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DiscountAllocationService } from '../services/discount-allocation.service';
import { DiscountReservationService } from '../services/discount-reservation.service';

/**
 * Phase 62 (2026-05-22) — discount allocation recovery worker
 * (audit Gap #12).
 *
 * Pre-Phase-62 a failed `allocateAndPersist` left the redemption
 * stuck in RESERVED and only emitted a `discount.allocation.failed`
 * event for ops to handle manually. With no consumer the slot was
 * pinned until the 15-minute TTL ran out, blocking other customers
 * from a coupon whose reservation had no real owner.
 *
 * The recovery handler listens to the event and:
 *   1. Re-runs allocateAndPersist with the captured context (one
 *      retry — the underlying tx is idempotent so this is safe to
 *      run multiple times).
 *   2. If the retry also fails, defensively flips the redemption
 *      RESERVED → REDEEMED so the customer's already-charged
 *      order doesn't sit on a phantom RESERVED slot.
 *   3. Logs an ops-visible error on both paths so the operator
 *      can investigate the missing OrderItemDiscount rows
 *      offline.
 *
 * The handler is intentionally NOT idempotency-keyed at the event
 * layer — `allocateAndPersist` uses deterministic idempotency keys
 * per ledger row, so a duplicate event firing is a no-op (the
 * second call's inserts hit the unique constraint and silently
 * succeed).
 */
@Injectable()
export class DiscountAllocationRecoveryHandler {
  private readonly logger = new Logger(DiscountAllocationRecoveryHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly allocation: DiscountAllocationService,
    private readonly reservation: DiscountReservationService,
  ) {}

  @OnEvent('discount.allocation.failed')
  async onAllocationFailed(event: any): Promise<void> {
    const masterOrderId: string | undefined = event?.payload?.masterOrderId;
    const discountId: string | undefined = event?.payload?.discountId;
    const redemptionId: string | undefined = event?.payload?.redemptionId;
    const discountAmount: number | undefined = event?.payload?.discountAmount;

    if (!masterOrderId || !discountId || !redemptionId) {
      this.logger.warn(
        `discount.allocation.failed event missing required payload fields: ${JSON.stringify(event?.payload ?? {})}`,
      );
      return;
    }

    // Step 1 — attempt re-allocation with the same shape the
    // checkout service used. We need to read the discount row for
    // type/method/funding because the original event only carries
    // the discount id and amount; the full context isn't on the
    // event payload (we'd need to extend the schema for that).
    const discount = await this.prisma.discount.findUnique({
      where: { id: discountId },
      // Phase 247-FB — load the full funding split (not just fundingType) so
      // a recovered allocation books the SAME funding the checkout would
      // have, instead of degrading a SHARED/FRANCHISE/SELLER discount to a
      // bare type (which would also break splitFundingShares for SHARED).
      select: {
        type: true,
        method: true,
        fundingType: true,
        platformFundingPercent: true,
        sellerFundingPercent: true,
        brandFundingPercent: true,
        franchiseFundingPercent: true,
        franchiseId: true,
        brandId: true,
      },
    });
    if (!discount) {
      this.logger.error(
        `Recovery aborted: discount ${discountId} not found for order ${masterOrderId}. Defensively marking redemption REDEEMED.`,
      );
      await this.defensivelyRedeem(redemptionId, masterOrderId);
      return;
    }

    try {
      await this.allocation.allocateAndPersist({
        masterOrderId,
        discountId,
        discountCode: null,
        redemptionId,
        discountAmountInPaise: BigInt(Math.round((discountAmount ?? 0) * 100)),
        discountType: discount.type as any,
        discountMethod: discount.method as any,
        source: 'CODE',
        funding: {
          fundingType: discount.fundingType as any,
          platformFundingPercent: Number(discount.platformFundingPercent ?? 100),
          sellerFundingPercent: Number(discount.sellerFundingPercent ?? 0),
          brandFundingPercent: Number(discount.brandFundingPercent ?? 0),
          franchiseFundingPercent: Number(discount.franchiseFundingPercent ?? 0),
          franchiseId: discount.franchiseId ?? null,
          brandId: discount.brandId ?? null,
        },
      } as any);
      this.logger.log(
        `Allocation recovery succeeded for order ${masterOrderId} (discount=${discountId})`,
      );
    } catch (err) {
      this.logger.error(
        `Allocation recovery retry failed for order ${masterOrderId}: ${(err as Error).message}. ` +
          `Defensively marking redemption REDEEMED so the slot isn't held forever.`,
        (err as Error).stack,
      );
      await this.defensivelyRedeem(redemptionId, masterOrderId);
    }
  }

  /**
   * Phase 62 — flip RESERVED → REDEEMED outside the allocation tx
   * so the coupon slot isn't permanently held when the per-item
   * ledger can't be rebuilt. The order is already committed and
   * the customer was charged correctly; this is purely about
   * freeing the maxUses cap for the next customer.
   */
  private async defensivelyRedeem(
    redemptionId: string,
    masterOrderId: string,
  ): Promise<void> {
    try {
      await this.reservation.redeem({ redemptionId, masterOrderId });
    } catch (err) {
      this.logger.error(
        `Defensive redeem failed for redemption ${redemptionId}: ${(err as Error).message}. ` +
          `Manual cleanup may be needed — slot will release on TTL expiry (~15 min).`,
      );
    }
  }
}
