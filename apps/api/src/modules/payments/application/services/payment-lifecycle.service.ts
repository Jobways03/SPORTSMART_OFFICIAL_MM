import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Phase 70 (2026-05-22) — Phase 66 audit Gap #3 + Gap #10,
 * Phase 67 audit Gap #4. Payment entity scaffolding.
 *
 * Thin write-side service that populates the new `payments` table
 * alongside the existing MasterOrder.razorpay* + paymentStatus
 * columns. Pre-Phase-70 payment state lived entirely on MasterOrder;
 * the full intent-first refactor (Payment as primary, MasterOrder
 * referencing Payment) is a multi-day rewrite scoped for a later
 * phase. This shadow table gives that future phase a populated
 * dataset to pivot to without a separate backfill migration.
 *
 * Idempotency: every write is keyed on (masterOrderId, providerOrderId)
 * so a retried place-order or repeated webhook delivery doesn't
 * create duplicate Payment rows.
 */
@Injectable()
export class PaymentLifecycleService {
  private readonly logger = new Logger(PaymentLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a COD payment at order placement. status=PENDING (COD
   * is collected at delivery, not at place-order). Idempotent —
   * called once per COD order; a retry will no-op via the unique
   * index on masterOrderId+method.
   */
  async recordCodPayment(args: {
    masterOrderId: string;
    amountInPaise: bigint;
  }): Promise<void> {
    try {
      const existing = await this.prisma.payment.findFirst({
        where: { masterOrderId: args.masterOrderId, method: 'COD' },
        select: { id: true },
      });
      if (existing) return;
      await this.prisma.payment.create({
        data: {
          masterOrderId: args.masterOrderId,
          method: 'COD',
          status: 'PENDING',
          amountInPaise: args.amountInPaise,
        },
      });
    } catch (err) {
      // Best-effort: a failure to write the shadow row must not
      // break the customer's order.
      this.logger.warn(
        `recordCodPayment failed for order ${args.masterOrderId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Record an ONLINE payment after Razorpay createOrder succeeds.
   * status=CREATED — the payment intent exists at the gateway but
   * the customer hasn't completed the modal yet.
   */
  async recordOnlinePaymentCreated(args: {
    masterOrderId: string;
    amountInPaise: bigint;
    providerOrderId: string;
    idempotencyKey: string | null;
    expiresAt: Date;
  }): Promise<void> {
    try {
      await this.prisma.payment.upsert({
        where: { providerOrderId: args.providerOrderId } as any,
        update: {
          status: 'CREATED',
          amountInPaise: args.amountInPaise,
          expiresAt: args.expiresAt,
          idempotencyKey: args.idempotencyKey,
        },
        create: {
          masterOrderId: args.masterOrderId,
          method: 'ONLINE',
          status: 'CREATED',
          amountInPaise: args.amountInPaise,
          providerOrderId: args.providerOrderId,
          idempotencyKey: args.idempotencyKey,
          expiresAt: args.expiresAt,
        },
      });
    } catch (err) {
      this.logger.warn(
        `recordOnlinePaymentCreated failed for order ${args.masterOrderId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Record a wallet-only payment (online order fully covered by
   * wallet balance — no gateway round-trip). status=CAPTURED
   * immediately since the wallet debit is synchronous.
   */
  async recordWalletOnlyPayment(args: {
    masterOrderId: string;
    amountInPaise: bigint;
  }): Promise<void> {
    try {
      const existing = await this.prisma.payment.findFirst({
        where: { masterOrderId: args.masterOrderId, method: 'WALLET_ONLY' },
        select: { id: true },
      });
      if (existing) return;
      const now = new Date();
      await this.prisma.payment.create({
        data: {
          masterOrderId: args.masterOrderId,
          method: 'WALLET_ONLY',
          status: 'CAPTURED',
          amountInPaise: args.amountInPaise,
          capturedAt: now,
        },
      });
    } catch (err) {
      this.logger.warn(
        `recordWalletOnlyPayment failed for order ${args.masterOrderId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Flip a Payment row to CAPTURED on verify-payment success or
   * webhook capture event. Idempotent — repeated calls just
   * stamp the latest providerPaymentId.
   */
  async markCaptured(args: {
    providerOrderId: string;
    providerPaymentId: string;
  }): Promise<void> {
    try {
      await this.prisma.payment.updateMany({
        where: { providerOrderId: args.providerOrderId },
        data: {
          status: 'CAPTURED',
          providerPaymentId: args.providerPaymentId,
          capturedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `markCaptured failed for providerOrder ${args.providerOrderId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Flip Payment row(s) to a terminal failure / void / cancel
   * state. Called from the order-cancel, payment-expiry, and
   * webhook-failed paths.
   */
  async markTerminal(args: {
    masterOrderId: string;
    status: 'FAILED' | 'VOIDED' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';
  }): Promise<void> {
    try {
      await this.prisma.payment.updateMany({
        where: {
          masterOrderId: args.masterOrderId,
          status: { in: ['CREATED', 'PENDING'] },
        },
        data: {
          status: args.status,
          terminalAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `markTerminal failed for order ${args.masterOrderId}: ${(err as Error).message}`,
      );
    }
  }
}
