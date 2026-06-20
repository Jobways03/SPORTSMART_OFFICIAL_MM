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
 * `CheckoutSessionService`, which holds ephemeral checkout-flow state.) This
 * service owns the session ROW + its state machine; the order-creation
 * ORCHESTRATION lives in `CheckoutService.materializeOrderFromSession`.
 *   • createSession         — snapshot the EXACT placeOrderTransaction input at
 *                             checkout-init (NO order, NO wallet debit).
 *   • attachRazorpayOrder   — stamp the gateway order id once created.
 *   • decodeSnapshot        — revive the frozen snapshot for replay on capture.
 *   • claimForMaterialization / markOrderCreated / markFailed / markExpired /
 *     markRefunded / failStuckPaid / markFailedAwaitingRefund — the CAS-guarded
 *     CREATED→PAID→ORDER_CREATED | EXPIRED | FAILED transitions.
 *
 * Gated by CHECKOUT_DEFERRED_ORDER_CREATION; callers fall back to the legacy
 * create-then-pay path when off. Fully wired (Phases 1-6): materialize on the
 * sync verify + the Razorpay webhook + the deferred-capture recovery cron;
 * the Phase-5 reconciler auto-refunds a captured-but-failed session.
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

/**
 * The exact inputs materialize() replays from a captured CheckoutSession —
 * placeInput (for placeOrderTransaction) + the materialize-only extras
 * (reservation links for stock-confirm, discount-commit context). Decoded from
 * the frozen cartSnapshot by decodeSnapshot().
 */
export interface DeferredMaterializeInput {
  placeInput: PlaceOrderTransactionInput;
  reservationLinks: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
    reservationId: string | null;
    allocatedNodeType: string | null;
    allocatedSellerId: string | null;
  }>;
  discountId: string | null;
  allocationEnabled: boolean;
  discountReservationId: string | null;
  walletDebitInPaise: number;
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
    // Phase 2 — the extra inputs materialize() needs that aren't in
    // PlaceOrderTransactionInput: the per-item reservation links (to confirm
    // stock on payment success) + the discount-commit context. Optional so the
    // signature stays back-compatible.
    reservationLinks?: Array<{
      productId: string;
      variantId: string | null;
      quantity: number;
      reservationId: string | null;
      allocatedNodeType: string | null;
      allocatedSellerId: string | null;
    }>;
    discountId?: string | null;
    allocationEnabled?: boolean;
    discountReservationId?: string | null;
  }): Promise<CheckoutSession> {
    const expiresAt = new Date(Date.now() + args.windowMinutes * 60_000);
    return this.prisma.checkoutSession.create({
      data: {
        customerId: args.placeInput.customerId,
        status: 'CREATED',
        paymentMethod: (args.placeInput.paymentMethod ?? 'ONLINE') as never,
        addressId: args.addressId,
        shippingAddressSnapshot: args.placeInput.addressSnapshot as never,
        // The FULL replay payload — placeInput + the materialize-only extras.
        // decodeSnapshot() revives this exact shape and
        // CheckoutService.materializeOrderFromSession replays it on capture.
        cartSnapshot: toJsonSafe({
          placeInput: args.placeInput,
          reservationLinks: args.reservationLinks ?? [],
          discountId: args.discountId ?? null,
          allocationEnabled: args.allocationEnabled ?? false,
          discountReservationId: args.discountReservationId ?? null,
          walletDebitInPaise: Number(args.walletApplyInPaise),
        }) as never,
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

  // ── Session state machine (Phase 3) ────────────────────────────────────
  // The order-creation ORCHESTRATION (placeOrderTransaction + the shared
  // confirmStockAndDebitWallet / runOrderDiscountAndTax / emitOrderCreatedEvents
  // + the PAID/PLACED flip) lives in CheckoutService.materializeOrderFromSession
  // — it needs those private methods + all the facades. This service owns only
  // the CheckoutSession state transitions + snapshot decode.

  /**
   * Find a deferred checkout session by its Razorpay order id. verify passes
   * the customerId (defence-in-depth on the authed sync path); the webhook /
   * poller pass none (gateway-trusted). razorpayOrderId is @unique so this
   * resolves at most one session.
   */
  async findByRazorpayOrderId(
    razorpayOrderId: string,
    customerId?: string | null,
  ): Promise<CheckoutSession | null> {
    return this.prisma.checkoutSession.findFirst({
      where: {
        razorpayOrderId,
        ...(customerId ? { customerId } : {}),
      },
    });
  }

  /** Decode the frozen snapshot into the exact inputs materialize() replays. */
  decodeSnapshot(session: CheckoutSession): DeferredMaterializeInput {
    const s = reviveJson(
      session.cartSnapshot,
    ) as Partial<DeferredMaterializeInput>;
    return {
      placeInput: s.placeInput as PlaceOrderTransactionInput,
      reservationLinks:
        (s.reservationLinks as DeferredMaterializeInput['reservationLinks']) ??
        [],
      discountId: s.discountId ?? null,
      allocationEnabled: s.allocationEnabled ?? false,
      discountReservationId: s.discountReservationId ?? null,
      // Prefer the pristine BigInt column over the snapshot's Number mirror.
      walletDebitInPaise: Number(session.walletApplyInPaise),
    };
  }

  /**
   * CAS-claim the session for materialization — the exactly-once guard. Flips
   * CREATED → PAID (the "gateway captured, order not yet created" state) and
   * stamps the payment id, ATOMICALLY. Exactly one concurrent caller (verify /
   * webhook / poller) wins (claimed=true); losers get claimed=false and must
   * NOT run the order side-effects (which aren't idempotent — e.g. wallet
   * debit). A crash after a successful claim leaves the session PAID with no
   * masterOrderId for the Phase-5 reconciler to finish or refund.
   */
  async claimForMaterialization(
    sessionId: string,
    razorpayPaymentId: string,
  ): Promise<{ claimed: boolean }> {
    const res = await this.prisma.checkoutSession.updateMany({
      where: { id: sessionId, status: 'CREATED' },
      data: { status: 'PAID', razorpayPaymentId },
    });
    return { claimed: res.count > 0 };
  }

  /**
   * Link the materialized order: PAID → ORDER_CREATED. CAS-guarded on
   * status='PAID' so it is mutually exclusive with the reconciler's
   * failStuckPaid (and a second leader / a double call): exactly one of
   * link-vs-fail wins, and a session already ORDER_CREATED/FAILED is never
   * clobbered. claimed=false ⇒ someone already advanced the session (benign).
   */
  async markOrderCreated(
    sessionId: string,
    masterOrderId: string,
  ): Promise<{ claimed: boolean }> {
    const res = await this.prisma.checkoutSession.updateMany({
      where: { id: sessionId, status: 'PAID' },
      data: {
        status: 'ORDER_CREATED',
        masterOrderId,
        orderCreatedAt: new Date(),
      },
    });
    return { claimed: res.count > 0 };
  }

  /**
   * Captured payment but the order could NOT be created (stock gone, price
   * drift, …). Mark FAILED so the Phase-5 reconciler auto-refunds against it.
   * Best-effort: never throw out of a failure path.
   */
  async markFailed(sessionId: string, reason: string): Promise<void> {
    await this.prisma.checkoutSession
      .update({
        where: { id: sessionId },
        data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
      })
      .catch(() => undefined);
  }

  // ── Phase 5 reconciler transitions ─────────────────────────────────────

  /**
   * CAS-expire an abandoned session (CREATED past expiresAt, never captured).
   * Guarded on status='CREATED' so it never races a concurrent materialize
   * (which would have flipped it to PAID). claimed=true ⇒ this caller owns the
   * release of the held stock/discount.
   */
  async markExpired(sessionId: string): Promise<{ claimed: boolean }> {
    const res = await this.prisma.checkoutSession.updateMany({
      where: { id: sessionId, status: 'CREATED' },
      data: { status: 'EXPIRED' },
    });
    return { claimed: res.count > 0 };
  }

  /**
   * CAS-stamp the gateway refund onto a FAILED session — the exactly-once guard
   * for the reconciler's auto-refund. Guarded on refundedAt IS NULL so a re-run
   * (or a second leader) can't double-stamp; the Razorpay idempotency key makes
   * the refund call itself safe even if two callers reach the gateway. claimed=
   * true ⇒ this caller stamped it.
   */
  async markRefunded(
    sessionId: string,
    refundReference: string | null,
  ): Promise<{ claimed: boolean }> {
    const res = await this.prisma.checkoutSession.updateMany({
      // Guard on status='FAILED' too — only a FAILED session is refundable;
      // never stamp a refund onto an ORDER_CREATED/EXPIRED/etc. session.
      where: { id: sessionId, status: 'FAILED', refundedAt: null },
      data: { refundedAt: new Date(), refundReference },
    });
    return { claimed: res.count > 0 };
  }

  /**
   * Reconciler-only: CAS-fail a session that is stuck PAID with no order. Guarded
   * on status='PAID' AND masterOrderId IS NULL so a materialize that completed
   * (set masterOrderId / flipped to ORDER_CREATED) between the reconciler's read
   * and this write is NEVER clobbered — closes the in-flight TOCTOU that would
   * otherwise refund a valid paid order. claimed=true ⇒ this caller failed it.
   */
  async failStuckPaid(
    sessionId: string,
    reason: string,
  ): Promise<{ claimed: boolean }> {
    const res = await this.prisma.checkoutSession.updateMany({
      where: { id: sessionId, status: 'PAID', masterOrderId: null },
      data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
    });
    return { claimed: res.count > 0 };
  }

  /**
   * A capture arrived for a session that can no longer become an order (an
   * EXPIRED session whose window had already closed — a delayed webhook / late
   * async capture). Stamp it FAILED + the payment id so the Phase-5 refund sweep
   * refunds the captured money instead of stranding it. Best-effort. An EXPIRED
   * session never claimed (no side-effects ran), so this is a pure refund.
   */
  async markFailedAwaitingRefund(
    sessionId: string,
    razorpayPaymentId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.checkoutSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'FAILED',
          razorpayPaymentId,
          failureReason: reason.slice(0, 500),
        },
      })
      .catch(() => undefined);
  }
}
