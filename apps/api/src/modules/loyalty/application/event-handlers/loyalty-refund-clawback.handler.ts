import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LoyaltyService } from '../services/loyalty.service';

/**
 * Phase 182 (make-it-100%) — when an order that earned a loyalty rebate is
 * refunded, claw back the (proportional) cashback so a returned purchase doesn't
 * keep its reward. Best-effort: never blocks the refund flow.
 */
@Injectable()
export class LoyaltyRefundClawbackHandler {
  private readonly logger = new Logger(LoyaltyRefundClawbackHandler.name);

  constructor(private readonly loyalty: LoyaltyService) {}

  @OnEvent('orders.refund.required')
  async onRefundRequired(event: { payload?: { masterOrderId?: string; amountInPaise?: string | number } }): Promise<void> {
    if (!this.loyalty.enabled()) return;
    const orderId = event?.payload?.masterOrderId;
    const refunded = event?.payload?.amountInPaise;
    if (!orderId || refunded == null) return;
    try {
      await this.loyalty.clawbackForOrder({ orderId, refundedAmountInPaise: Number(refunded) });
    } catch (err) {
      this.logger.error(
        `Loyalty clawback failed for order ${orderId}: ${(err as Error).message}`,
      );
    }
  }
}
