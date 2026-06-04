import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';

/**
 * Phase 184 (#6) — when the compensating wallet-refund saga (fired after a
 * checkout that debited the wallet then failed at the gateway) EXHAUSTS its
 * retries and is ABANDONED, the customer's wallet is debited with no order and
 * no automatic refund. That is a real money-loss vector, so we open a high-
 * severity PaymentMismatchAlert for finance to manually credit the wallet.
 *
 * (The saga itself — durable PENDING→FAILED→ABANDONED with cron retry — already
 * makes the compensating credit far more than fire-and-forget; this closes the
 * last gap: surfacing the unrecoverable tail to a human.)
 */
@Injectable()
export class WalletRefundSagaAbandonedHandler {
  private readonly logger = new Logger(WalletRefundSagaAbandonedHandler.name);

  constructor(private readonly paymentOps: PaymentOpsFacade) {}

  @OnEvent('wallet.refund_saga.abandoned')
  async onAbandoned(event: {
    payload?: { sagaId?: string; orderId?: string; customerId?: string; amountInPaise?: string; lastError?: string };
  }): Promise<void> {
    const p = event?.payload;
    if (!p?.customerId) return;
    const rupees = p.amountInPaise ? (Number(p.amountInPaise) / 100).toFixed(2) : '?';
    try {
      await this.paymentOps.flagMismatch({
        kind: 'AMOUNT_MISMATCH',
        masterOrderId: p.orderId ?? null,
        actualInPaise: p.amountInPaise ?? null,
        severity: 95,
        description:
          `Wallet refund saga ABANDONED — customer ${p.customerId} is owed ₹${rupees} ` +
          `(order ${p.orderId ?? '?'}; wallet was debited but the gateway order failed and the ` +
          `compensating credit could not complete after all retries${p.lastError ? `: ${p.lastError}` : ''}). ` +
          `Manual wallet credit required.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to raise alert for abandoned wallet-refund saga ${p.sagaId}: ${(err as Error).message}`,
      );
    }
  }
}
