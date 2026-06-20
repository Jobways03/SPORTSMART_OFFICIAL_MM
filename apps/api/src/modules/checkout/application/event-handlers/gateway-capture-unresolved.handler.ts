import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { CheckoutService } from '../services/checkout.service';

/**
 * Option B (Phase 4) — the consumer for a captured ONLINE payment that the
 * payments webhook could NOT route to a MasterOrder.
 *
 * For a DEFERRED checkout no MasterOrder exists until capture, so the webhook
 * resolves nothing and (Phase 4) emits `payments.gateway_capture_unresolved`
 * instead of silently dropping the payment. This handler — living in the
 * CHECKOUT module so the payments module never imports checkout (cycle-safe;
 * the event bus is the only coupling) — materializes the order from the owning
 * CheckoutSession. If no session owns the gateway order id it is a genuine
 * legacy orphan and materializeFromGateway no-ops.
 *
 * Exactly-once is owned downstream by the session CAS (claimForMaterialization);
 * this handler is just the dispatch. The deferred-capture recovery cron is the
 * backstop if this handler fails (e.g. transient DB error).
 */
@Injectable()
export class GatewayCaptureUnresolvedHandler {
  private readonly logger = new Logger(GatewayCaptureUnresolvedHandler.name);

  constructor(private readonly checkoutService: CheckoutService) {}

  @OnEvent('payments.gateway_capture_unresolved')
  async handle(event: DomainEvent): Promise<void> {
    const p = event.payload as {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      capturedAmountInPaise?: string;
    };
    if (!p?.razorpayOrderId || !p?.razorpayPaymentId) {
      this.logger.warn(
        `gateway_capture_unresolved: malformed payload ${JSON.stringify(p)}`,
      );
      return;
    }
    try {
      const res = await this.checkoutService.materializeFromGateway(
        p.razorpayOrderId,
        p.razorpayPaymentId,
      );
      if (res) {
        this.logger.log(
          `Deferred capture materialized order ${res.orderNumber} from gateway ` +
            `order ${p.razorpayOrderId} (payment ${p.razorpayPaymentId}).`,
        );
      } else {
        // No owning session / terminal / concurrent / unconfirmed amount — all
        // safe no-ops. The recovery cron re-attempts genuine in-flight sessions.
        this.logger.log(
          `Deferred capture for gateway order ${p.razorpayOrderId} not ` +
            `materialized here (no owning session, terminal, or concurrent).`,
        );
      }
    } catch (err) {
      // materializeFromGateway is designed not to throw; guard anyway so a
      // handler exception never escapes into the event bus.
      this.logger.error(
        `gateway_capture_unresolved handler failed for ${p.razorpayOrderId} ` +
          `(payment ${p.razorpayPaymentId}): ${(err as Error).message}`,
      );
    }
  }
}
