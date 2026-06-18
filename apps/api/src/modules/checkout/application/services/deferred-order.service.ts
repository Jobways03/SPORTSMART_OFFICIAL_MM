import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CheckoutSession } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  CHECKOUT_REPOSITORY,
  ICheckoutRepository,
  PlaceOrderTransactionInput,
} from '../../domain/repositories/checkout.repository.interface';

/**
 * Option B — DEFERRED ORDER CREATION.
 *
 * Owns the persisted `CheckoutSession` so the real MasterOrder is created only
 * once an ONLINE payment is captured. (Distinct from the Redis-backed
 * `CheckoutSessionService`, which holds ephemeral checkout-flow state.)
 *   • createSession         — snapshot the EXACT placeOrderTransaction input at
 *                             checkout-init (NO order, NO wallet debit).
 *   • attachRazorpayOrder   — stamp the gateway order id once created.
 *   • createOrderFromSession — on capture, REPLAY the snapshot through
 *                             placeOrderTransaction. Idempotent against the
 *                             verify+webhook race.
 *
 * Gated by CHECKOUT_DEFERRED_ORDER_CREATION; callers fall back to the legacy
 * create-then-pay path when off. NOT yet wired into live checkout — Stage 2
 * wiring + Stage 3 (reverse-orphan refund) come next.
 */

// The snapshot lives in a Json column, so it must be BigInt-free. The
// placeOrderTransaction input nests paise BigInts (shippingFeeInPaise + per-item
// prices inside fulfillmentGroups), so we serialize/revive deeply rather than
// hand-converting individual fields — one fewer place to miss a BigInt and
// crash JSON.stringify.
function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return { __bigint__: value.toString() };
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonSafe(v);
    }
    return out;
  }
  return value;
}

function reviveJson(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const maybeBig = value as { __bigint__?: string };
    if (typeof maybeBig.__bigint__ === 'string') return BigInt(maybeBig.__bigint__);
    if (Array.isArray(value)) return value.map(reviveJson);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = reviveJson(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class DeferredOrderService {
  private readonly logger = new Logger(DeferredOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    @Inject(CHECKOUT_REPOSITORY)
    private readonly repo: ICheckoutRepository,
  ) {}

  /** Master switch — when off, callers keep the legacy create-then-pay path. */
  enabled(): boolean {
    return this.env.getBoolean('CHECKOUT_DEFERRED_ORDER_CREATION', false);
  }

  /**
   * Persist a session snapshotting the exact placeOrderTransaction input, so it
   * can be replayed verbatim once payment is captured. No order, no wallet
   * debit yet. The caller then creates the Razorpay order and calls
   * `attachRazorpayOrder`.
   */
  async createSession(args: {
    placeInput: PlaceOrderTransactionInput;
    walletApplyInPaise: bigint;
    gatewayAmountInPaise: bigint;
    addressId: string | null;
    windowMinutes: number;
  }): Promise<CheckoutSession> {
    const expiresAt = new Date(Date.now() + args.windowMinutes * 60_000);
    return this.prisma.checkoutSession.create({
      data: {
        customerId: args.placeInput.customerId,
        status: 'CREATED',
        paymentMethod: (args.placeInput.paymentMethod ?? 'ONLINE') as never,
        addressId: args.addressId,
        shippingAddressSnapshot: args.placeInput.addressSnapshot as never,
        cartSnapshot: toJsonSafe(args.placeInput) as never,
        itemCount: args.placeInput.itemCount,
        totalAmountInPaise: BigInt(
          Math.round(args.placeInput.totalAmount * 100),
        ),
        walletApplyInPaise: args.walletApplyInPaise,
        gatewayAmountInPaise: args.gatewayAmountInPaise,
        couponCode: args.placeInput.discountCode ?? null,
        discountAmountInPaise: BigInt(
          Math.round((args.placeInput.discountAmount ?? 0) * 100),
        ),
        expiresAt,
      },
    });
  }

  /** Stamp the Razorpay order id once it's created against the session. */
  async attachRazorpayOrder(
    sessionId: string,
    razorpayOrderId: string,
  ): Promise<void> {
    await this.prisma.checkoutSession.update({
      where: { id: sessionId },
      data: { razorpayOrderId },
    });
  }

  /**
   * Replay a captured session through placeOrderTransaction to create the real
   * order. Idempotent against the verify+webhook race:
   *   • already ORDER_CREATED → returns the existing order.
   *   • the snapshot carries placeOrderTransaction's own idempotencyKey, so a
   *     true double-fire still yields exactly one order; we then link it.
   * Returns null + marks FAILED when the order can't be created (caller issues
   * the refund — Stage 3).
   */
  async createOrderFromSession(
    sessionId: string,
    razorpayPaymentId: string,
  ): Promise<{ masterOrderId: string; orderNumber: string } | null> {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      this.logger.warn(`createOrderFromSession: session ${sessionId} not found`);
      return null;
    }
    if (session.status === 'ORDER_CREATED' && session.masterOrderId) {
      const existing = await this.prisma.masterOrder.findUnique({
        where: { id: session.masterOrderId },
        select: { id: true, orderNumber: true },
      });
      if (existing) {
        return { masterOrderId: existing.id, orderNumber: existing.orderNumber };
      }
    }

    const placeInput = reviveJson(
      session.cartSnapshot,
    ) as PlaceOrderTransactionInput;

    let result;
    try {
      result = await this.repo.placeOrderTransaction(placeInput);
    } catch (err) {
      // Captured payment but order creation failed (e.g. stock gone). Mark the
      // session FAILED; Stage 3's reconciler auto-refunds against it.
      await this.prisma.checkoutSession
        .update({
          where: { id: sessionId },
          data: {
            status: 'FAILED',
            razorpayPaymentId,
            failureReason: (err as Error).message.slice(0, 500),
          },
        })
        .catch(() => undefined);
      this.logger.error(
        `Order creation FAILED for paid session ${sessionId} (payment ${razorpayPaymentId}): ${(err as Error).message} — flagged for refund.`,
      );
      return null;
    }

    await this.prisma.checkoutSession.update({
      where: { id: sessionId },
      data: {
        status: 'ORDER_CREATED',
        masterOrderId: result.masterOrderId,
        razorpayPaymentId,
        orderCreatedAt: new Date(),
      },
    });
    this.logger.log(
      `Order ${result.orderNumber} created from checkout session ${sessionId} (payment ${razorpayPaymentId}).`,
    );
    return {
      masterOrderId: result.masterOrderId,
      orderNumber: result.orderNumber,
    };
  }
}
