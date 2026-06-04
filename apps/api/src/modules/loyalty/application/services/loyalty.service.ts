import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';

/**
 * Phase 182 (Customer Wallet audit #2/#3) — the loyalty/cashback pillar's
 * PRODUCER. A captured order earns `LOYALTY_CASHBACK_BPS` of its eligible value
 * as a LOYALTY_REBATE wallet credit (config-driven; capped; min-order floor;
 * expiring). Idempotent per (sourceType, sourceId) via LoyaltyEarnEvent's unique
 * index AND the wallet's own (referenceType, referenceId, type) idempotency.
 *
 * Default OFF (LOYALTY_ENABLED=false) — turning on a money-emitting feature is a
 * business decision. Tiered/complex rules are a future config extension; this is
 * the working single-rate cashback engine the spec's third pillar requires.
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly wallet: WalletPublicFacade,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('LOYALTY_ENABLED', false);
  }

  /**
   * Earn loyalty for a completed order. Safe to call repeatedly (idempotent).
   * Returns the resulting LoyaltyEarnEvent.
   */
  async earnForOrder(args: {
    userId: string;
    orderId: string;
    orderNumber?: string;
    eligibleAmountInPaise: number;
  }) {
    if (!this.enabled()) return null;

    // Idempotency: one event per order. A re-emitted payment.captured returns
    // the existing row instead of re-crediting.
    const existing = await this.prisma.loyaltyEarnEvent.findUnique({
      where: { sourceType_sourceId: { sourceType: 'ORDER', sourceId: args.orderId } },
    });
    if (existing) return existing;

    const bps = this.env.getNumber('LOYALTY_CASHBACK_BPS', 100);
    const maxPaise = this.env.getNumber('LOYALTY_CASHBACK_MAX_PAISE', 50000);
    const minOrderPaise = this.env.getNumber('LOYALTY_MIN_ORDER_PAISE', 50000);
    const expiryDays = this.env.getNumber('LOYALTY_EARN_EXPIRY_DAYS', 180);
    const eligible = Math.max(0, Math.floor(args.eligibleAmountInPaise));

    // Below the floor → record a SKIPPED event (audit trail) and stop.
    if (eligible < minOrderPaise || bps <= 0) {
      return this.createEvent(args, eligible, bps, 0, 'SKIPPED', `below min-order or zero rate`);
    }

    const rebate = Math.min(Math.floor((eligible * bps) / 10000), maxPaise);
    if (rebate <= 0) {
      return this.createEvent(args, eligible, bps, 0, 'SKIPPED', 'computed rebate ≤ 0');
    }

    const expiresAt = new Date(Date.now() + expiryDays * 86_400_000);

    // Create the PENDING event first (unique on order) so a race is deduped.
    let event;
    try {
      event = await this.createEvent(args, eligible, bps, rebate, 'PENDING', null, expiresAt);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return this.prisma.loyaltyEarnEvent.findUnique({
          where: { sourceType_sourceId: { sourceType: 'ORDER', sourceId: args.orderId } },
        });
      }
      throw err;
    }

    // Post the wallet credit (itself idempotent on LOYALTY:orderId).
    const result = await this.wallet.creditLoyalty({
      userId: args.userId,
      amountInPaise: rebate,
      orderId: args.orderId,
      orderNumber: args.orderNumber,
      description: `Loyalty cashback for order ${args.orderNumber ?? args.orderId}`,
      expiresAt,
    });

    const posted = await this.prisma.loyaltyEarnEvent.update({
      where: { id: event.id },
      data: { status: 'POSTED', walletTransactionId: result.transaction.id, postedAt: new Date() },
    });
    this.logger.log(
      `Loyalty rebate ₹${(rebate / 100).toFixed(2)} for order ${args.orderNumber ?? args.orderId} (user ${args.userId})`,
    );
    return posted;
  }

  /**
   * Clawback a loyalty rebate when the earning order is refunded. Proportional
   * to the refund (rebate × refunded / eligible), once per order (idempotent via
   * clawedBackInPaise), clamped to the wallet balance. Conservative on multi-
   * partial refunds: only the first refund event claws back (never over-claws).
   */
  async clawbackForOrder(args: { orderId: string; refundedAmountInPaise: number }) {
    if (!this.enabled()) return null;
    const event = await this.prisma.loyaltyEarnEvent.findUnique({
      where: { sourceType_sourceId: { sourceType: 'ORDER', sourceId: args.orderId } },
    });
    if (!event || event.status !== 'POSTED') return null;
    if (event.clawedBackInPaise > 0n) return event; // already clawed — idempotent

    const rebate = Number(event.rebateInPaise);
    const eligible = Number(event.eligibleAmountInPaise);
    if (rebate <= 0 || eligible <= 0) return event;
    const refunded = Math.max(0, Math.floor(args.refundedAmountInPaise));
    const proportional = Math.min(rebate, Math.floor((rebate * refunded) / eligible));
    if (proportional <= 0) return event;

    const { clawedBackInPaise } = await this.wallet.debitLoyaltyClawback({
      userId: event.userId,
      orderId: args.orderId,
      amountInPaise: proportional,
    });
    if (clawedBackInPaise <= 0) return event;
    this.logger.log(
      `Loyalty clawback ₹${(clawedBackInPaise / 100).toFixed(2)} for refunded order ${args.orderId}`,
    );
    return this.prisma.loyaltyEarnEvent.update({
      where: { id: event.id },
      data: { clawedBackInPaise: BigInt(clawedBackInPaise) },
    });
  }

  private createEvent(
    args: { userId: string; orderId: string },
    eligible: number,
    bps: number,
    rebate: number,
    status: 'PENDING' | 'POSTED' | 'SKIPPED',
    skipReason: string | null,
    expiresAt?: Date,
  ) {
    return this.prisma.loyaltyEarnEvent.create({
      data: {
        userId: args.userId,
        sourceType: 'ORDER',
        sourceId: args.orderId,
        eligibleAmountInPaise: BigInt(eligible),
        rebateInPaise: BigInt(rebate),
        rateBps: bps,
        status,
        skipReason,
        expiresAt: expiresAt ?? null,
      },
    });
  }

  async listEvents(params: { userId?: string; status?: string; page: number; limit: number }) {
    const where: any = {};
    if (params.userId) where.userId = params.userId;
    if (params.status) where.status = params.status;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.loyaltyEarnEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (params.page - 1) * params.limit, take: params.limit }),
      this.prisma.loyaltyEarnEvent.count({ where }),
    ]);
    return { items, total };
  }
}
