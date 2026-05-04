import { Injectable } from '@nestjs/common';
import { WalletService } from '../services/wallet.service';

/**
 * Cross-module entry point for wallet operations. Other modules (refunds,
 * checkout) import this facade rather than the service directly so the
 * surface area stays small and stable.
 */
@Injectable()
export class WalletPublicFacade {
  constructor(private readonly wallet: WalletService) {}

  getBalance(userId: string) {
    return this.wallet.getBalance(userId);
  }

  /**
   * Credit a refund payout into the user's wallet. Wired from the
   * returns/refunds module when refundMethod === 'WALLET'.
   */
  creditFromRefund(args: {
    userId: string;
    amountInPaise: number;
    refundId: string;
    description?: string;
  }) {
    return this.wallet.credit({
      userId: args.userId,
      amountInPaise: args.amountInPaise,
      type: 'REFUND',
      referenceType: 'refund',
      referenceId: args.refundId,
      description:
        args.description ??
        `Refund credit — ₹${(args.amountInPaise / 100).toFixed(2)}`,
      // Refunds are regulatory and must land even on blocked wallets;
      // an admin can still set a manual debit later if a chargeback
      // ends up reversing this credit.
      bypassBlock: true,
    });
  }

  /**
   * Deduct a wallet portion of a checkout total. Called from the checkout
   * service when the buyer opts in to "Use wallet balance".
   */
  debitForCheckout(args: {
    userId: string;
    amountInPaise: number;
    orderId: string;
    description?: string;
  }) {
    return this.wallet.debit({
      userId: args.userId,
      amountInPaise: args.amountInPaise,
      type: 'DEBIT',
      referenceType: 'order',
      referenceId: args.orderId,
      description:
        args.description ??
        `Checkout — ₹${(args.amountInPaise / 100).toFixed(2)}`,
    });
  }

  /**
   * Compensating credit when an order placement that already debited the
   * wallet later fails (e.g. gateway init error). Logged as a CREDIT
   * adjustment with a clear linkage back to the failed order so audit
   * trails see both the original DEBIT and this reversal.
   */
  creditCheckoutCancellation(args: {
    userId: string;
    amountInPaise: number;
    orderId: string;
    reason?: string;
  }) {
    return this.wallet.credit({
      userId: args.userId,
      amountInPaise: args.amountInPaise,
      type: 'CREDIT_ADJUSTMENT',
      referenceType: 'order_cancellation',
      referenceId: args.orderId,
      description: `Refund: order ${args.orderId} could not be completed`,
      internalNotes: args.reason,
    });
  }

  /** Read-only check used by checkout to fail-fast before order creation. */
  async hasSufficientBalance(userId: string, amountInPaise: number): Promise<boolean> {
    const { balanceInPaise } = await this.wallet.getBalance(userId);
    return balanceInPaise >= amountInPaise;
  }
}
