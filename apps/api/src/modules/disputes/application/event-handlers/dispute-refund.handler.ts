import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';

interface DecidedPayload {
  disputeId: string;
  disputeNumber: string;
  outcome: 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT';
  amountInPaise: number | null;
  rationale: string;
  filedByType: 'CUSTOMER' | 'SELLER' | 'ADMIN';
  filedById: string;
  masterOrderId: string | null;
  subOrderId: string | null;
  returnId: string | null;
}

/**
 * Convert a buyer-favoured dispute decision into a wallet credit. We
 * pick wallet (not gateway refund) because dispute resolutions are
 * typically time-sensitive and the buyer can use the credit immediately
 * — a gateway refund would take 5-7 days. Admin can manually request a
 * gateway refund instead via the returns module if the buyer prefers.
 *
 * Only triggers for CUSTOMER-filed RESOLVED_BUYER / RESOLVED_SPLIT.
 * Seller-filed disputes don't refund (other party is not money-receiving).
 */
@Injectable()
export class DisputeRefundHandler {
  private readonly logger = new Logger(DisputeRefundHandler.name);

  constructor(private readonly wallet: WalletPublicFacade) {}

  @OnEvent('disputes.decided')
  async onDecided(event: DomainEvent<DecidedPayload>) {
    const p = event.payload;
    if (p.outcome === 'RESOLVED_SELLER') return;
    if (p.filedByType !== 'CUSTOMER') return;
    if (!p.amountInPaise || p.amountInPaise <= 0) return;

    try {
      await this.wallet.creditFromRefund({
        userId: p.filedById,
        amountInPaise: p.amountInPaise,
        refundId: `dispute:${p.disputeId}`,
        description:
          `Dispute ${p.disputeNumber} resolved — ` +
          `₹${(p.amountInPaise / 100).toFixed(2)} refunded to wallet`,
      });
      this.logger.log(
        `Wallet credit applied for dispute ${p.disputeNumber}: ₹${(p.amountInPaise / 100).toFixed(2)}`,
      );
    } catch (err) {
      this.logger.error(
        `Dispute refund failed for ${p.disputeNumber}: ${(err as Error).message}`,
      );
    }
  }
}
