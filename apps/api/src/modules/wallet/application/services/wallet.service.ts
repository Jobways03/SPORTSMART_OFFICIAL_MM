import { Inject, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { assertGatewayPaymentMatchesOrder } from '../../../../core/money/gateway-amount-verifier';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { RazorpayAdapter } from '../../../../integrations/razorpay';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';
import {
  ApplyMutationResult,
  WalletEntity,
  WalletRepository,
  WALLET_REPOSITORY,
} from '../../domain/repositories/wallet.repository.interface';
import { WalletVersionConflictError } from '../../infrastructure/repositories/prisma-wallet.repository';

const VERSION_CONFLICT_MAX_RETRIES = 5;

export interface CreditArgs {
  userId: string;
  amountInPaise: number;
  description: string;
  type?: 'REFUND' | 'CREDIT_ADJUSTMENT';
  referenceType?: string;
  referenceId?: string;
  internalNotes?: string;
  createdByAdminId?: string;
  /**
   * Allow this credit to bypass the wallet-block check. ONLY refund
   * flows that must complete (regulatory) should set this. Default false.
   */
  bypassBlock?: boolean;
}

export interface DebitArgs {
  userId: string;
  amountInPaise: number;
  description: string;
  type?: 'DEBIT' | 'DEBIT_ADJUSTMENT';
  referenceType?: string;
  referenceId?: string;
  internalNotes?: string;
  createdByAdminId?: string;
  /** Same semantics as CreditArgs.bypassBlock. */
  bypassBlock?: boolean;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @Inject(WALLET_REPOSITORY) private readonly repo: WalletRepository,
    private readonly razorpay: RazorpayAdapter,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
    // Phase 0 (PR 0.2) — used to record AMOUNT_MISMATCH alerts on top-up
    // verifications where the gateway-captured amount diverges from the
    // pending row's expected amount. PaymentOpsModule is `@Global()` so
    // this is available without changing WalletModule.imports.
    private readonly paymentOpsFacade: PaymentOpsFacade,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────

  async getBalance(userId: string): Promise<{
    balanceInPaise: number;
    currency: string;
  }> {
    const wallet = await this.repo.findByUserId(userId);
    return {
      balanceInPaise: wallet?.balanceInPaise ?? 0,
      currency: wallet?.currency ?? 'INR',
    };
  }

  async listTransactions(userId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const result = await this.repo.listTransactions({
      userId,
      page: safePage,
      limit: safeLimit,
    });
    return {
      items: result.items,
      page: safePage,
      limit: safeLimit,
      total: result.total,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Mutations (with optimistic-lock retry)
  // ─────────────────────────────────────────────────────────────────

  async credit(args: CreditArgs): Promise<ApplyMutationResult> {
    this.assertPositive(args.amountInPaise, 'amountInPaise');

    // Phase 3 (PR 3.2) — fast-path idempotency. If this exact
    // (referenceType, referenceId, type) was already credited, return
    // that row instead of attempting (and failing on the unique index).
    // The unique index is the source of truth; this check is just a
    // performance + clarity improvement that avoids a P2002 round-trip.
    const txType = args.type ?? 'CREDIT_ADJUSTMENT';
    if (args.referenceType && args.referenceId) {
      const existing = await this.repo.findTransactionByReference({
        referenceType: args.referenceType,
        referenceId: args.referenceId,
        type: txType,
      });
      if (existing) {
        const wallet = await this.repo.getOrCreate(args.userId);
        return { wallet, transaction: existing };
      }
    }

    let result: ApplyMutationResult;
    try {
      result = await this.applyWithRetry(args.userId, async (wallet) => {
        await this.assertNotBlocked(wallet, args.bypassBlock, {
          actorId: args.createdByAdminId ?? undefined,
          actorRole: args.createdByAdminId ? 'ADMIN' : 'SYSTEM',
          reason:
            args.bypassBlock && wallet.isBlocked
              ? `Wallet credit while blocked — ${args.description}`
              : undefined,
          referenceType: args.referenceType,
          referenceId: args.referenceId,
        });
        const newBalance = wallet.balanceInPaise + args.amountInPaise;
        return this.repo.applyMutation({
          walletId: wallet.id,
          expectedVersion: wallet.version,
          newBalanceInPaise: newBalance,
          transaction: {
            walletId: wallet.id,
            userId: args.userId,
            type: txType,
            amountInPaise: args.amountInPaise,
            balanceAfterInPaise: newBalance,
            referenceType: args.referenceType ?? null,
            referenceId: args.referenceId ?? null,
            description: args.description,
            internalNotes: args.internalNotes ?? null,
            createdByAdminId: args.createdByAdminId ?? null,
          },
        });
      });
    } catch (err) {
      // Race: a parallel write for the same reference won the unique
      // index. Re-fetch and return the winning row, preserving idempotency.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        args.referenceType &&
        args.referenceId
      ) {
        const winner = await this.repo.findTransactionByReference({
          referenceType: args.referenceType,
          referenceId: args.referenceId,
          type: txType,
        });
        if (winner) {
          const wallet = await this.repo.getOrCreate(args.userId);
          this.logger.warn(
            `Wallet credit idempotency race: returning existing tx ${winner.id} for ref ${args.referenceType}:${args.referenceId}`,
          );
          return { wallet, transaction: winner };
        }
      }
      throw err;
    }

    // Best-effort event publish (handlers run async via EventBus's
    // microtask; failures are logged in the bus, not propagated).
    try {
      await this.eventBus.publish({
        eventName: 'wallet.credited',
        aggregate: 'Wallet',
        aggregateId: result.wallet.id,
        occurredAt: new Date(),
        payload: {
          userId: args.userId,
          amountInPaise: args.amountInPaise,
          balanceAfterInPaise: result.wallet.balanceInPaise,
          description: args.description,
          walletTransactionId: result.transaction.id,
          type: result.transaction.type,
        },
      });
    } catch {
      // events are best-effort
    }

    return result;
  }

  async debit(args: DebitArgs): Promise<ApplyMutationResult> {
    this.assertPositive(args.amountInPaise, 'amountInPaise');
    return this.applyWithRetry(args.userId, async (wallet) => {
      await this.assertNotBlocked(wallet, args.bypassBlock, {
        actorId: args.createdByAdminId ?? undefined,
        actorRole: args.createdByAdminId ? 'ADMIN' : 'SYSTEM',
        reason:
          args.bypassBlock && wallet.isBlocked
            ? `Wallet debit while blocked — ${args.description}`
            : undefined,
        referenceType: args.referenceType,
        referenceId: args.referenceId,
      });
      if (wallet.balanceInPaise < args.amountInPaise) {
        throw new BadRequestAppException(
          `Insufficient wallet balance. Available ₹${(wallet.balanceInPaise / 100).toFixed(2)}`,
        );
      }
      const newBalance = wallet.balanceInPaise - args.amountInPaise;
      return this.repo.applyMutation({
        walletId: wallet.id,
        expectedVersion: wallet.version,
        newBalanceInPaise: newBalance,
        transaction: {
          walletId: wallet.id,
          userId: args.userId,
          type: args.type ?? 'DEBIT',
          amountInPaise: -args.amountInPaise,
          balanceAfterInPaise: newBalance,
          referenceType: args.referenceType ?? null,
          referenceId: args.referenceId ?? null,
          description: args.description,
          internalNotes: args.internalNotes ?? null,
          createdByAdminId: args.createdByAdminId ?? null,
        },
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Top-up via Razorpay
  // ─────────────────────────────────────────────────────────────────

  async initiateTopup(args: {
    userId: string;
    amountInPaise: number;
  }): Promise<{
    walletTransactionId: string;
    razorpayOrderId: string;
    amountInPaise: number;
    currency: string;
  }> {
    this.assertPositive(args.amountInPaise, 'amountInPaise');
    if (args.amountInPaise < 100) {
      throw new BadRequestAppException('Minimum top-up is ₹1');
    }
    // Phase 70 (2026-05-22) — Phase 66 audit Gap #19. Env-tunable
    // cap. Default ₹1,00,000 (10,000,000 paise) preserves prior
    // behaviour; ops can raise after KYC review without redeploy.
    const maxTopupPaise = Number(
      process.env.WALLET_MAX_TOPUP_PAISE ?? 10_000_000,
    );
    if (args.amountInPaise > maxTopupPaise) {
      throw new BadRequestAppException(
        `Maximum single top-up is ₹${(maxTopupPaise / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`,
      );
    }

    const wallet = await this.repo.getOrCreate(args.userId);

    // Create the gateway order BEFORE the pending ledger row, so a
    // gateway failure leaves no orphan row in our DB.
    // Phase 0 (PR 0.5) — adapter takes BigInt paise. `args.amountInPaise`
    // is already paise; just coerce to bigint.
    //
    // Phase 4 (PR 4.3) — derive the idempotency key from the receipt
    // we just generated. Same call ⇒ same receipt ⇒ same key, so a
    // transient 5xx + retry produces one order at Razorpay rather
    // than two orphan orders both billing the customer.
    const receipt = `wallet-topup-${Date.now()}-${args.userId.slice(0, 8)}`;
    const rzpOrder = await this.razorpay.createOrder({
      amountInPaise: BigInt(args.amountInPaise),
      receipt,
      notes: { kind: 'wallet_topup', userId: args.userId },
      idempotencyKey: `wallet-topup-${receipt}`,
    });

    const pending = await this.repo.insertPending({
      walletId: wallet.id,
      userId: args.userId,
      type: 'TOPUP',
      status: 'PENDING',
      amountInPaise: args.amountInPaise,
      balanceAfterInPaise: wallet.balanceInPaise, // unchanged at PENDING
      referenceType: 'razorpay_order',
      referenceId: rzpOrder.providerOrderId,
      description: `Wallet top-up — ₹${(args.amountInPaise / 100).toFixed(2)}`,
    });

    return {
      walletTransactionId: pending.id,
      razorpayOrderId: rzpOrder.providerOrderId,
      amountInPaise: args.amountInPaise,
      currency: rzpOrder.currency,
    };
  }

  async verifyTopup(args: {
    userId: string;
    walletTransactionId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): Promise<ApplyMutationResult> {
    const tx = await this.repo.findTransactionById(args.walletTransactionId);
    if (!tx) throw new NotFoundAppException('Wallet top-up not found');
    if (tx.userId !== args.userId) {
      throw new NotFoundAppException('Wallet top-up not found');
    }
    if (tx.type !== 'TOPUP') {
      throw new BadRequestAppException('Transaction is not a top-up');
    }
    if (tx.referenceId !== args.razorpayOrderId) {
      throw new BadRequestAppException(
        'Top-up does not match the Razorpay order',
      );
    }

    // HMAC-SHA256 of `${order_id}|${payment_id}` keyed by RAZORPAY_KEY_SECRET.
    // Fail closed if the secret is missing — matches checkout's behaviour.
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      throw new BadRequestAppException(
        'Top-up verification unavailable — gateway not configured',
      );
    }
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${args.razorpayOrderId}|${args.razorpayPaymentId}`)
      .digest('hex');
    const expBuf = Buffer.from(expected, 'utf8');
    const actBuf = Buffer.from(args.razorpaySignature, 'utf8');
    const ok =
      expBuf.length === actBuf.length &&
      crypto.timingSafeEqual(expBuf, actBuf);
    if (!ok) {
      throw new BadRequestAppException('Top-up signature verification failed');
    }

    // Phase 0 (PR 0.2) — silent-money-loss guard. The HMAC above only
    // proves Razorpay emitted this (orderId, paymentId) pair. It does
    // NOT prove the payment was captured for the same amount the pending
    // row was created with. Without this, a customer (or attacker who
    // intercepts the callback) can submit a ₹1 payment id and have
    // ₹10,000 credited to their wallet. We re-fetch the payment from
    // Razorpay (the source of truth) and reject if the snapshot doesn't
    // match the pending row's amount.
    let gatewayPayment;
    try {
      gatewayPayment = await this.razorpay.getRawPayment(args.razorpayPaymentId);
    } catch (err: any) {
      this.logger.error(
        `Razorpay fetchPayment failed for wallet topup ${args.razorpayPaymentId}: ${err?.message ?? err}`,
      );
      throw new BadRequestAppException(
        'Top-up verification failed — could not confirm with gateway. Please retry shortly.',
      );
    }

    try {
      assertGatewayPaymentMatchesOrder(gatewayPayment, {
        totalAmountInPaise: BigInt(tx.amountInPaise),
        razorpayOrderId: args.razorpayOrderId,
      });
    } catch (err: any) {
      // Fire-and-forget — never block the throw on alert-write failure.
      this.paymentOpsFacade
        .flagMismatch({
          kind: err.code === 'GATEWAY_AMOUNT_MISMATCH'
            ? 'AMOUNT_MISMATCH'
            : 'SIGNATURE_INVALID',
          providerPaymentId: args.razorpayPaymentId,
          expectedInPaise: tx.amountInPaise,
          // Pass BigInt directly — flagMismatch accepts bigint now,
          // avoiding the precision loss of Number() on > ₹9 lakh.
          actualInPaise: BigInt(gatewayPayment.amount),
          severity: 95, // money-safety — top of triage queue
          description:
            `Wallet top-up gateway verification rejected for user ${args.userId} ` +
            `(razorpay_order ${args.razorpayOrderId}, payment ${args.razorpayPaymentId}): ${err.message}.`,
        })
        .catch((alertErr) =>
          this.logger.error(
            `Failed to record PaymentMismatchAlert for wallet topup: ${alertErr?.message ?? alertErr}`,
          ),
        );
      throw err;
    }

    return this.applyWithRetry(args.userId, async (wallet) => {
      const newBalance = wallet.balanceInPaise + tx.amountInPaise;
      return this.repo.completePending({
        transactionId: tx.id,
        walletId: wallet.id,
        expectedVersion: wallet.version,
        newBalanceInPaise: newBalance,
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  private assertPositive(amount: number, label: string) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestAppException(`${label} must be a positive integer (paise)`);
    }
  }

  /**
   * Block gate. Throws when the wallet is blocked unless the caller
   * explicitly opts out via `bypass=true` (refund paths only — wallet
   * credits during a fraud-hold are how the customer gets their money
   * back from a refund). Every bypass writes an audit row so we have
   * a tamper-evident record of who chose to override the block and
   * why.
   *
   * `bypassContext` carries the reason + actor identification when
   * provided; falls back to a minimal "REFUND_OVERRIDE" placeholder so
   * the audit trail is never empty.
   */
  private async assertNotBlocked(
    wallet: WalletEntity,
    bypass?: boolean,
    bypassContext?: {
      actorId?: string;
      actorRole?: string;
      reason?: string;
      referenceType?: string;
      referenceId?: string;
    },
  ) {
    if (bypass && wallet.isBlocked) {
      // Bypass actually consumed — write an audit row. Fire-and-forget
      // because audit-write failure shouldn't strand a customer's
      // refund, but log loudly if it does.
      this.audit
        .writeAuditLog({
          actorId: bypassContext?.actorId,
          actorRole: bypassContext?.actorRole ?? 'SYSTEM',
          action: 'WALLET_BLOCK_BYPASSED',
          module: 'wallet',
          resource: 'Wallet',
          resourceId: wallet.id,
          oldValue: { isBlocked: true, blockedReason: wallet.blockedReason },
          newValue: { bypassApplied: true },
          metadata: {
            reason:
              bypassContext?.reason ??
              'REFUND_OVERRIDE (no explicit reason provided)',
            referenceType: bypassContext?.referenceType,
            referenceId: bypassContext?.referenceId,
            walletUserId: wallet.userId,
          },
        })
        .catch((err) => {
          this.logger.error(
            `Failed to audit wallet block bypass for wallet=${wallet.id} userId=${wallet.userId}: ${(err as Error).message}`,
          );
        });
      return;
    }
    if (bypass) return; // Block wasn't on; bypass is a no-op.
    if (wallet.isBlocked) {
      throw new BadRequestAppException(
        `Wallet is blocked${wallet.blockedReason ? `: ${wallet.blockedReason}` : ''}. Contact support.`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Block / Unblock (admin only)
  // ─────────────────────────────────────────────────────────────────

  async setBlocked(args: {
    userId: string;
    isBlocked: boolean;
    reason?: string;
    adminId?: string;
  }) {
    const wallet = await this.repo.setBlocked({
      userId: args.userId,
      isBlocked: args.isBlocked,
      reason: args.reason,
      adminId: args.adminId,
    });
    // Cross-cutting audit. Best-effort — wallet state already persisted.
    this.audit
      ?.writeAuditLog({
        actorId: args.adminId,
        action: args.isBlocked ? 'wallet.block' : 'wallet.unblock',
        module: 'wallets',
        resource: 'wallet',
        resourceId: wallet.id,
        newValue: { isBlocked: args.isBlocked, reason: args.reason },
      })
      .catch(() => undefined);
    return wallet;
  }

  private async applyWithRetry<T>(
    userId: string,
    op: (wallet: WalletEntity) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= VERSION_CONFLICT_MAX_RETRIES; attempt++) {
      const wallet = await this.repo.getOrCreate(userId);
      try {
        return await op(wallet);
      } catch (err) {
        if (err instanceof WalletVersionConflictError && attempt < VERSION_CONFLICT_MAX_RETRIES) {
          this.logger.warn(
            `Wallet version conflict for user ${userId}, attempt ${attempt}/${VERSION_CONFLICT_MAX_RETRIES} — retrying`,
          );
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestAppException('Wallet busy — please retry');
  }
}
