import { Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { assertGatewayPaymentMatchesOrder } from '../../../../core/money/gateway-amount-verifier';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';

/**
 * PaymentsPublicFacade — uses OrdersPublicFacade for all order data access.
 * Does NOT inject PrismaService directly (strict modular monolith).
 */
@Injectable()
export class PaymentsPublicFacade {
  constructor(
    private readonly ordersFacade: OrdersPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    // Phase 0 (PR 0.1) — used to record AMOUNT_MISMATCH / NOT_CAPTURED /
    // ORDER_ID_MISMATCH alerts when a gateway-supplied amount diverges
    // from the order's expected total. PaymentOpsModule is `@Global()`
    // so this is available without changing PaymentsModule.imports.
    private readonly paymentOpsFacade: PaymentOpsFacade,
  ) {
    this.logger.setContext('PaymentsPublicFacade');
  }

  /**
   * Mark a master order as PAID.
   *
   * Phase 0 (PR 0.1): when `gatewaySnapshot` is supplied (webhook + verify
   * paths), the helper asserts the gateway-reported captured amount
   * equals the order's `totalAmountInPaise`, the gateway's order_id
   * matches the razorpay_order_id we minted, and the payment is fully
   * captured. Manual admin "mark paid" paths omit the snapshot and the
   * check is skipped — operators are expected to have eyeballed the
   * order before clicking the button, and the audit trail records who
   * did it.
   *
   * On mismatch: writes a `PaymentMismatchAlert` (AMOUNT_MISMATCH /
   * SIGNATURE_INVALID-class) and throws. The caller decides whether to
   * acknowledge or retry the webhook delivery.
   */
  async markOrderPaid(params: {
    masterOrderId: string;
    actorType: string;
    actorId?: string;
    paymentReference?: string;
    notes?: string;
    /**
     * Phase 0 (PR 0.1) — gateway-reported payment snapshot. Pass this
     * from the webhook handler and from `checkout.verifyPayment`. Omit
     * for admin manual mark-paid (the operator has separately reviewed).
     */
    gatewaySnapshot?: {
      amount: number | bigint;
      status: string;
      captured: boolean;
      order_id: string;
    };
  }) {
    const order = await this.ordersFacade.getMasterOrderBasic(params.masterOrderId);
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.paymentStatus === 'PAID') {
      this.logger.warn(`Order ${order.orderNumber} already PAID`);
      return order;
    }
    if (order.paymentStatus === 'CANCELLED' || order.paymentStatus === 'VOIDED') {
      throw new BadRequestAppException(
        `Cannot mark order as PAID — current status: ${order.paymentStatus}`,
      );
    }

    // Phase 0 (PR 0.1) — silent-money-loss guard. Centralised in the
    // facade so the webhook handler and checkout.verifyPayment both
    // share the same contract.
    if (params.gatewaySnapshot) {
      if (!order.razorpayOrderId) {
        // The order was never assigned a razorpay_order_id but is being
        // marked paid via the gateway-snapshot path. Indicates a routing
        // bug somewhere upstream.
        throw new BadRequestAppException(
          `Order ${order.orderNumber} has no razorpay_order_id; cannot verify gateway payment`,
          'GATEWAY_ORDER_ID_MISMATCH',
        );
      }
      try {
        assertGatewayPaymentMatchesOrder(params.gatewaySnapshot, {
          totalAmountInPaise: BigInt(order.totalAmountInPaise),
          razorpayOrderId: order.razorpayOrderId,
        });
      } catch (err: any) {
        // Best-effort alert — fire-and-forget so a logging outage
        // doesn't block the throw. The throw IS the load-bearing
        // safety: it stops the order from flipping PAID.
        this.paymentOpsFacade
          .flagMismatch({
            kind: err.code === 'GATEWAY_AMOUNT_MISMATCH'
              ? 'AMOUNT_MISMATCH'
              : 'SIGNATURE_INVALID',
            masterOrderId: order.id,
            orderNumber: order.orderNumber,
            providerPaymentId: params.paymentReference ?? null,
            // Pass paise as BigInt directly — the facade now accepts
            // number | bigint | string, so we avoid the lossy Number()
            // coercion that previously masked the last digits of any
            // amount > ₹9 lakh.
            expectedInPaise: order.totalAmountInPaise,
            actualInPaise: BigInt(params.gatewaySnapshot.amount),
            severity: 95, // top of the queue — money safety
            description:
              `Gateway payment rejected for order ${order.orderNumber}: ${err.message}. ` +
              `actor=${params.actorType} actorId=${params.actorId ?? 'n/a'}`,
          })
          .catch((alertErr) =>
            this.logger.error(
              `Failed to record PaymentMismatchAlert: ${alertErr?.message ?? alertErr}`,
            ),
          );
        throw err;
      }
    }

    // Phase 0 (PR 0.12) — TOCTOU close. Replace the unconditional
    // `updatePaymentStatus` with a status-conditional updateMany so
    // exactly one concurrent caller flips PENDING/FAILED → PAID and
    // emits `payments.payment.captured`. Losers see `flipped=false`
    // and exit without firing downstream side-effects (commission
    // lock, notifications, AffiliateCommission row creation).
    const { flipped, order: latest } = await this.ordersFacade.flipPaymentStatusIfFrom(
      params.masterOrderId,
      ['PENDING', 'FAILED'],
      'PAID',
    );

    if (!flipped) {
      this.logger.warn(
        `Order ${order.orderNumber}: concurrent caller already flipped paymentStatus ` +
          `(now ${latest?.paymentStatus ?? 'unknown'}). Skipping event publish to ` +
          `prevent duplicate commission / notification fan-out.`,
      );
      return latest ?? order;
    }

    this.eventBus
      .publish({
        eventName: 'payments.payment.captured',
        aggregate: 'MasterOrder',
        aggregateId: params.masterOrderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: params.masterOrderId,
          orderNumber: order.orderNumber,
          amount: Number(order.totalAmount),
          // Phase 0 (PR 0.1) — include the paise total so downstream
          // handlers don't have to re-cast Decimal. The Number `amount`
          // above is preserved for the soak window.
          amountInPaise: order.totalAmountInPaise.toString(),
          paymentMethod: order.paymentMethod,
          paymentReference: params.paymentReference,
          actorType: params.actorType,
          actorId: params.actorId,
        },
      })
      .catch(() => {});

    this.logger.log(`Order ${order.orderNumber} marked PAID by ${params.actorType}`);
    return latest ?? order;
  }

  async getOrderPaymentStatus(masterOrderId: string) {
    const order = await this.ordersFacade.getOrderPaymentStatus(masterOrderId);
    if (!order) throw new NotFoundAppException('Order not found');
    return order;
  }

  async markOrderPaymentFailed(params: {
    masterOrderId: string;
    reason: string;
    actorType: string;
  }) {
    const order = await this.ordersFacade.getMasterOrderBasic(params.masterOrderId);
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.paymentStatus === 'PAID') {
      throw new BadRequestAppException('Cannot mark a PAID order as failed');
    }

    const updated = await this.ordersFacade.updatePaymentStatus(params.masterOrderId, 'CANCELLED');

    this.eventBus
      .publish({
        eventName: 'payments.payment.failed',
        aggregate: 'MasterOrder',
        aggregateId: params.masterOrderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: params.masterOrderId,
          orderNumber: order.orderNumber,
          reason: params.reason,
        },
      })
      .catch(() => {});

    return updated;
  }
}
