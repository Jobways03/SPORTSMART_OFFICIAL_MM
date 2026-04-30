import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AffiliatePublicFacade } from '../facades/affiliate-public.facade';

/**
 * Listens to the existing order/payment events and drives the
 * affiliate commission lifecycle. Each handler is idempotent — the
 * underlying facade methods all guard against duplicate work.
 *
 * Events consumed (already emitted by other modules):
 *   payments.payment.captured     → create PENDING commission
 *   orders.sub_order.delivered    → set return-window timestamp
 *   orders.master.cancelled       → cancel-or-reverse
 *   orders.refund.processed       → cancel-or-reverse
 */
@Injectable()
export class AffiliateOrderEventHandler {
  private readonly logger = new Logger(AffiliateOrderEventHandler.name);

  constructor(private readonly affiliateFacade: AffiliatePublicFacade) {}

  /**
   * Online payments emit this once Razorpay confirms capture; the COD
   * path emits the same event from orders.service.ts after admin
   * marks the COD order paid (see orders.service.ts:678).
   */
  @OnEvent('payments.payment.captured')
  async onPaymentCaptured(event: any) {
    const orderId = event?.aggregateId || event?.payload?.masterOrderId;
    if (!orderId) return;
    try {
      await this.affiliateFacade.createCommissionForOrder({ orderId });
    } catch (err) {
      this.logger.error(
        `Failed to create affiliate commission for order ${orderId}: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * SRS §11 — return window starts at delivery. We mirror the
   * sub-order's returnWindowEndsAt onto the commission so the cron
   * job (next phase) can flip PENDING → CONFIRMED.
   */
  @OnEvent('orders.sub_order.delivered')
  async onSubOrderDelivered(event: any) {
    const masterOrderId = event?.payload?.masterOrderId;
    const returnWindowEndsAt =
      event?.payload?.returnWindowEndsAt &&
      new Date(event.payload.returnWindowEndsAt);
    if (!masterOrderId || !returnWindowEndsAt) return;
    try {
      await this.affiliateFacade.setReturnWindowForOrder(
        masterOrderId,
        returnWindowEndsAt,
      );
    } catch (err) {
      this.logger.error(
        `Failed to set affiliate return-window for order ${masterOrderId}: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Admin cancels a sub-order. The facade picks CANCELLED vs
   * REVERSED based on commission state. Note: this fires per
   * sub-order — for orders that route to multiple sellers/franchises,
   * a partial cancellation should ideally use applyAdjustment with
   * the cancelled-line-items value rather than killing the whole
   * commission. We handle that nuance in Phase 2; for now the all-
   * or-nothing behaviour matches the seller-commission module's
   * existing pattern (commissionProcessed flag).
   */
  @OnEvent('orders.sub_order.cancelled_by_admin')
  async onSubOrderCancelledByAdmin(event: any) {
    const orderId = event?.payload?.masterOrderId;
    const reason = event?.payload?.reason || 'order cancelled by admin';
    if (!orderId) return;
    try {
      await this.affiliateFacade.cancelOrReverseForOrder(orderId, reason);
    } catch (err) {
      this.logger.error(
        `Failed to cancel affiliate commission for order ${orderId}: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Refund webhook finalised — the customer has been credited. SRS
   * §12.3 — cancel if the commission is still pre-payout, reverse
   * if already paid. The facade does the right thing.
   */
  @OnEvent('returns.refund.completed')
  async onRefundCompleted(event: any) {
    const orderId = event?.payload?.masterOrderId;
    const reason = event?.payload?.reason || 'refund completed';
    if (!orderId) return;
    try {
      await this.affiliateFacade.cancelOrReverseForOrder(orderId, reason);
    } catch (err) {
      this.logger.error(
        `Failed to reverse affiliate commission for order ${orderId}: ${(err as Error)?.message}`,
      );
    }
  }
}
