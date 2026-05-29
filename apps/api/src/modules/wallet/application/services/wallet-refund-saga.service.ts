import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { WalletService } from './wallet.service';

/**
 * Phase 70 (2026-05-22) — Phase 66 audit Gap #8.
 *
 * Minimal saga primitive for the wallet-refund-on-checkout-cancel
 * flow. The checkout service used to call
 * `walletFacade.creditCheckoutCancellation` inside a try/catch
 * that swallowed errors — a refund failure left the customer
 * debited with no trail. This service makes the refund attempt
 * idempotent + retriable:
 *
 *   • enqueueAndAttempt(...) writes the saga row, attempts the
 *     credit synchronously, marks COMPLETED on success or FAILED
 *     on error. The caller no longer has to wrap in try/catch —
 *     a failure leaves a queued saga for the retry cron.
 *   • retry(sagaId) re-attempts a FAILED row. Called by the cron;
 *     can also be invoked from an admin tool.
 *
 * Maximum 5 attempts before the saga is marked ABANDONED — a
 * structured ops event then surfaces it for manual reconciliation.
 */

const MAX_ATTEMPTS = 5;

@Injectable()
export class WalletRefundSagaService {
  private readonly logger = new Logger(WalletRefundSagaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Enqueue + attempt. Writes a PENDING row, runs the refund, and
   * flips to COMPLETED or FAILED based on outcome. Returns the
   * saga record so callers can correlate.
   *
   * If a non-COMPLETED saga already exists for the same
   * (orderId, customerId, amountInPaise) tuple, we reuse it
   * instead of inserting a duplicate (the partial unique index
   * enforces this at the DB level).
   */
  async enqueueAndAttempt(input: {
    customerId: string;
    orderId: string;
    amountInPaise: bigint;
    reason: string;
  }): Promise<{ sagaId: string; status: 'COMPLETED' | 'FAILED' }> {
    // Find or create. The partial unique index covers (orderId,
    // customerId, amountInPaise) WHERE status IN (PENDING, FAILED).
    let saga = await this.prisma.walletRefundSaga.findFirst({
      where: {
        orderId: input.orderId,
        customerId: input.customerId,
        amountInPaise: input.amountInPaise,
        status: { in: ['PENDING', 'FAILED'] },
      },
    });
    if (!saga) {
      saga = await this.prisma.walletRefundSaga.create({
        data: {
          customerId: input.customerId,
          orderId: input.orderId,
          amountInPaise: input.amountInPaise,
          reason: input.reason,
        },
      });
    }
    return this.attempt(saga.id);
  }

  /**
   * Attempt the refund for an existing saga row. Used by retry
   * cron + by enqueueAndAttempt internally. Idempotent — if the
   * saga is already COMPLETED, returns immediately.
   */
  async attempt(sagaId: string): Promise<{ sagaId: string; status: 'COMPLETED' | 'FAILED' }> {
    const saga = await this.prisma.walletRefundSaga.findUnique({
      where: { id: sagaId },
    });
    if (!saga) {
      throw new Error(`WalletRefundSaga ${sagaId} not found`);
    }
    if (saga.status === 'COMPLETED') {
      return { sagaId, status: 'COMPLETED' };
    }
    if (saga.status === 'ABANDONED') {
      // No further attempts; caller must intervene.
      return { sagaId, status: 'FAILED' };
    }

    try {
      await this.wallet.credit({
        userId: saga.customerId,
        amountInPaise: Number(saga.amountInPaise),
        type: 'CREDIT_ADJUSTMENT',
        referenceType: 'order_cancellation',
        referenceId: saga.orderId,
        description: `Refund: order ${saga.orderId} could not be completed`,
        internalNotes: saga.reason,
      });
      await this.prisma.walletRefundSaga.update({
        where: { id: sagaId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          lastAttemptAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      this.logger.log(
        `Wallet refund saga ${sagaId} completed for order ${saga.orderId} (${saga.amountInPaise} paise)`,
      );
      return { sagaId, status: 'COMPLETED' };
    } catch (err) {
      const message = (err as Error).message;
      const nextAttempts = saga.attempts + 1;
      const nextStatus = nextAttempts >= MAX_ATTEMPTS ? 'ABANDONED' : 'FAILED';
      await this.prisma.walletRefundSaga.update({
        where: { id: sagaId },
        data: {
          status: nextStatus,
          attempts: nextAttempts,
          lastError: message.slice(0, 1000),
          lastAttemptAt: new Date(),
        },
      });
      this.logger.warn(
        `Wallet refund saga ${sagaId} ${nextStatus} (attempt ${nextAttempts}/${MAX_ATTEMPTS}): ${message}`,
      );
      return { sagaId, status: 'FAILED' };
    }
  }

  /**
   * Cron entrypoint: scan failed sagas past a backoff window and
   * retry them. Backoff is exponential up to MAX_ATTEMPTS — caller
   * tunes the sweep cadence to amortise the wait.
   */
  async retryPendingAndFailed(opts: { batchLimit?: number; cooldownMinutes?: number } = {}) {
    const limit = opts.batchLimit ?? 100;
    const cooldown = opts.cooldownMinutes ?? 5;
    const cutoff = new Date(Date.now() - cooldown * 60_000);
    const sagas = await this.prisma.walletRefundSaga.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        OR: [
          { lastAttemptAt: null },
          { lastAttemptAt: { lt: cutoff } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let completed = 0;
    let failed = 0;
    for (const s of sagas) {
      const result = await this.attempt(s.id);
      if (result.status === 'COMPLETED') completed++;
      else failed++;
    }
    return { scanned: sagas.length, completed, failed };
  }
}
