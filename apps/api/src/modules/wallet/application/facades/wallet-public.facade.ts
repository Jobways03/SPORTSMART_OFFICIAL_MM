import { Injectable } from '@nestjs/common';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { WalletService } from '../services/wallet.service';

/**
 * Cross-module entry point for wallet operations. Other modules (refunds,
 * checkout) import this facade rather than the service directly so the
 * surface area stays small and stable.
 */
@Injectable()
export class WalletPublicFacade {
  constructor(
    private readonly wallet: WalletService,
    private readonly audit: AuditPublicFacade,
  ) {}

  getBalance(userId: string) {
    return this.wallet.getBalance(userId);
  }

  /**
   * Credit a refund payout into the user's wallet. Wired from the
   * returns/refunds module when refundMethod === 'WALLET'.
   *
   * Phase 13 — also writes a `wallet.refund_credit_created` audit
   * row for compliance reporting. Idempotent: repeated calls with the
   * same refundId reuse the same WalletTransaction (UNIQUE on
   * referenceType+referenceId+type) AND skip the audit write so the
   * audit ledger doesn't double-count the same logical event.
   */
  async creditFromRefund(args: {
    userId: string;
    amountInPaise: number;
    refundId: string;
    description?: string;
  }) {
    const result = await this.wallet.credit({
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

    // Audit only when this call actually moved money. WalletService
    // returns the existing transaction for an idempotent retry; the
    // CREATE timestamp gives us a >1-second-old check that's far
    // cheaper than introducing a `wasCreated` boolean to the contract.
    const justCreated =
      Date.now() - result.transaction.createdAt.getTime() < 5_000;
    if (justCreated) {
      this.audit
        .writeAuditLog({
          actorRole: 'SYSTEM',
          action: 'wallet.refund_credit_created',
          module: 'wallet',
          resource: 'wallet_transaction',
          resourceId: result.transaction.id,
          newValue: {
            userId: args.userId,
            amountInPaise: args.amountInPaise,
            refundId: args.refundId,
            walletId: result.transaction.walletId,
            balanceAfterInPaise: result.transaction.balanceAfterInPaise,
          },
        })
        .catch(() => undefined);
    }

    return result;
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

  /**
   * Phase 13 — Post a wallet adjustment (goodwill, time-barred refund,
   * or manual). Distinct from `creditFromRefund` so the audit trail
   * captures the adjustment ID (which carries the GST-policy context)
   * rather than a refund ID.
   *
   * Idempotency: the wallet ledger's UNIQUE on (referenceType,
   * referenceId, type) means the same adjustmentId can only post once.
   * Repeated calls return the existing wallet_transactions row.
   */
  creditAdjustment(args: {
    userId: string;
    amountInPaise: number;
    adjustmentId: string;
    description: string;
    internalNotes?: string;
    createdByAdminId?: string;
    /** Defaults to false; time-barred refunds set true to bypass holds. */
    bypassBlock?: boolean;
  }) {
    return this.wallet.credit({
      userId: args.userId,
      amountInPaise: args.amountInPaise,
      type: 'CREDIT_ADJUSTMENT',
      referenceType: 'wallet_adjustment',
      referenceId: args.adjustmentId,
      description: args.description,
      internalNotes: args.internalNotes,
      createdByAdminId: args.createdByAdminId,
      bypassBlock: args.bypassBlock ?? false,
    });
  }

  /** Phase 13 — Debit counterpart for MANUAL_DEBIT adjustments. */
  debitAdjustment(args: {
    userId: string;
    amountInPaise: number;
    adjustmentId: string;
    description: string;
    internalNotes?: string;
    createdByAdminId?: string;
  }) {
    return this.wallet.debit({
      userId: args.userId,
      amountInPaise: args.amountInPaise,
      type: 'DEBIT_ADJUSTMENT',
      referenceType: 'wallet_adjustment',
      referenceId: args.adjustmentId,
      description: args.description,
      internalNotes: args.internalNotes,
      createdByAdminId: args.createdByAdminId,
    });
  }
}
