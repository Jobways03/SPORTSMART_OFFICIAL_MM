import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import {
  CHECKOUT_REPOSITORY,
  ICheckoutRepository,
} from '../../domain/repositories/checkout.repository.interface';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';

@Injectable()
export class CustomerOrdersService {
  private readonly logger = new Logger(CustomerOrdersService.name);

  constructor(
    @Inject(CHECKOUT_REPOSITORY)
    private readonly repo: ICheckoutRepository,
    private readonly eventBus: EventBusService,
    // Phase 197 (Checkout audit #11 / My-Orders audit #11) — audit log
    // on customer-initiated cancel. AuditModule is @Global() so no
    // module wiring is required.
    private readonly audit: AuditPublicFacade,
    // Wallet refund on cancel. WalletModule is imported by CheckoutModule;
    // @Optional so the direct-construction spec harnesses still compile.
    @Optional()
    private readonly walletFacade?: WalletPublicFacade,
    // Used on cancel to verify whether the gateway actually CAPTURED a payment
    // that hadn't yet reconciled to PAID (the cancel-before-webhook race), so
    // the customer's money goes to the wallet instead of being stranded.
    // CheckoutModule already imports RazorpayModule; @Optional for spec harnesses.
    @Optional()
    private readonly razorpayAdapter?: RazorpayAdapter,
  ) {}

  // ── Legacy place-order ─────────────────────────────────────────────────

  async placeOrder(userId: string, addressId: string) {
    // Phase 197 (Checkout audit #20) — the legacy POST /customer/orders
    // place-order path predates the canonical checkout flow
    // (POST /customer/checkout/place-order). It has NO price-drift
    // re-validation, NO GST/tax snapshot, NO idempotency key, NO
    // moderation gate, and NO Razorpay/wallet integration — i.e. it
    // bypasses every checkout safety control added since Phase 44.
    // Neither the web nor mobile storefront calls it. Rather than
    // hard-delete (and risk an unknown internal caller), it is gated
    // OFF by default behind LEGACY_PLACE_ORDER_ENABLED; flip to 'true'
    // only for a deliberate, supervised migration.
    const legacyEnabled =
      (process.env.LEGACY_PLACE_ORDER_ENABLED ?? 'false').toLowerCase() ===
      'true';
    if (!legacyEnabled) {
      throw new BadRequestAppException(
        'This checkout path is no longer supported. Please use the standard checkout.',
      );
    }
    if (!addressId) {
      throw new BadRequestAppException('addressId is required');
    }

    // Validate address
    const address = await this.repo.findAddressByIdAndCustomer(addressId, userId);
    if (!address) {
      throw new NotFoundAppException('Address not found');
    }

    // Get cart with items
    const cart = await this.repo.findCartWithLegacyItems(userId);
    if (!cart || cart.items.length === 0) {
      throw new BadRequestAppException('Cart is empty');
    }

    // Address snapshot
    const addressSnapshot = {
      fullName: address.fullName,
      phone: address.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
    };

    const result = await this.repo.legacyPlaceOrderTransaction(
      userId,
      cart,
      addressSnapshot,
    );

    return result;
  }

  // ── Cancel order ───────────────────────────────────────────────────────

  async cancelOrder(userId: string, orderNumber: string) {
    const order = await this.repo.findMasterOrderWithSubOrders(orderNumber, userId);

    if (!order) {
      throw new NotFoundAppException('Order not found');
    }

    if (order.paymentStatus === 'CANCELLED') {
      throw new BadRequestAppException('Order is already cancelled');
    }

    // Once a sub-order has been shipped or delivered, this endpoint is the
    // wrong tool. cancelOrderTransaction unconditionally restores stock and
    // fully refunds commission — safe for pre-ship orders, wrong for goods
    // that are in transit or already with the customer. Post-ship cases must
    // route through the returns flow (QC + conditional stock restore +
    // audited commission reversal). A previous revision allowed cancel for
    // DELIVERED sub-orders while the return window was still open, which
    // effectively let customers self-return with zero QC.
    //
    // This is a CHEAP fail-fast pre-check off the already-loaded snapshot;
    // the AUTHORITATIVE re-check now runs INSIDE cancelOrderTransaction
    // under a row lock (My-Orders audit #15) so a sub-order that ships
    // between this read and the tx commit can't be silently cancelled.
    const blockingStatuses = new Set(['SHIPPED', 'DELIVERED', 'FULFILLED']);
    const hasBlockingSubOrder = order.subOrders.some((so) =>
      blockingStatuses.has(so.fulfillmentStatus as string),
    );
    if (hasBlockingSubOrder) {
      throw new BadRequestAppException(
        'This order has already shipped or been delivered. Please use the returns flow instead of cancelling.',
      );
    }

    await this.repo.cancelOrderTransaction(order);

    // Refund the wallet portion. Wallet is debited at checkout (ORDER_REDEMPTION,
    // master-level) regardless of payment status, so a wallet-paid order
    // cancelled BEFORE delivery must have that money returned — otherwise the
    // customer loses it for an order that never shipped. cancelOrderTransaction
    // always cancels the WHOLE master + every sub, so a single full-amount
    // refund is correct here. Routed through the durable, idempotent checkout-
    // cancellation refund saga (dedups on orderId+customerId+amountInPaise,
    // retries, finance-alerts on abandon) — NOT a one-shot credit that a
    // transient failure would silently lose. The PAID/ONLINE split-refund saga
    // does not run for these (PENDING) wallet orders, so there is no double
    // refund; and the saga's tuple can't collide with a place-order-crash comp.
    // Phase 258 — refund destination by stage:
    //   • PAID + cancelled BEFORE seller acceptance → return the FULL paid
    //     amount (gateway + wallet) to the wallet as instant store credit.
    //     Pre-fix this only refunded the wallet PORTION, so an online-paid
    //     order's gateway money was stranded on a cancel-before-delivery.
    //   • Otherwise (COD/wallet-PENDING orders, or a PAID order already past
    //     seller acceptance) → keep the wallet-portion-only behaviour; the
    //     gateway portion, if any, goes through the normal refund flow.
    const isPaid = order.paymentStatus === 'PAID';
    // Phase 258 — the cancel-to-wallet window is BEFORE SHIPMENT (the
    // blocking-status check above already rejects SHIPPED/DELIVERED/FULFILLED,
    // so any order that reaches here is pre-shipment). A PAID order cancelled
    // before shipment returns the FULL amount to the wallet as store credit.
    const isPreShipment = !order.subOrders.some((so) =>
      ['SHIPPED', 'DELIVERED', 'FULFILLED'].includes(so.fulfillmentStatus as string),
    );
    const walletPortionPaise = Number(order.walletAmountUsedInPaise ?? 0);
    const fullPaidPaise = Number((order as any).totalAmountInPaise ?? 0);

    // Cancel-before-payment-confirmed race: the customer may have actually paid
    // at the gateway, but the webhook/poller hadn't flipped paymentStatus to
    // PAID before this cancel landed (e.g. cancelled ~1 min after placing). The
    // order isn't `isPaid` yet, so the branch above would refund nothing and
    // strand the money. Verify with Razorpay: if a payment was genuinely
    // CAPTURED, return that captured amount to the wallet as store credit.
    // We credit ONLY a verified-captured payment (never an authorized-but-
    // uncaptured one → no free credit). The cancellation refund saga is
    // idempotent (dedups on orderId+customerId+amount), so this can't collide
    // with the poller's own recovery.
    let gatewayCapturedPaise = 0;
    const razorpayOrderId = (order as any).razorpayOrderId as string | null;
    if (!isPaid && razorpayOrderId && this.razorpayAdapter) {
      try {
        const payments =
          await this.razorpayAdapter.fetchOrderPayments(razorpayOrderId);
        const captured = payments
          .filter((p) => p.captured && p.status === 'captured')
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        if (captured) gatewayCapturedPaise = Number(captured.amountInPaise);
      } catch (err) {
        // Gateway unreachable — do NOT credit on uncertainty (avoid free money).
        // PaymentStatusPollerService still reconciles independently; log so ops
        // can recover a genuinely-captured payment.
        this.logger.error(
          `Gateway capture check failed on cancel for order ${orderNumber}: ${
            (err as Error)?.message
          }`,
        );
      }
    }

    const walletPaise =
      isPaid && isPreShipment
        ? fullPaidPaise
        : gatewayCapturedPaise > 0
          ? gatewayCapturedPaise
          : walletPortionPaise;
    if (walletPaise > 0 && this.walletFacade) {
      try {
        await this.walletFacade.enqueueCheckoutCancellationRefund({
          customerId: userId,
          orderId: order.id,
          amountInPaise: walletPaise,
          reason: `Order ${orderNumber} cancelled before shipment — wallet refund`,
        });
      } catch (err) {
        // The saga row + retry cron own recovery; a synchronous enqueue hiccup
        // must not block the cancel the customer already earned.
        this.logger.error(
          `Failed to enqueue wallet cancellation refund for order ${orderNumber}: ${
            (err as Error)?.message
          }`,
        );
      }
    }

    // Propagate the cancellation to the courier. A Delhivery sub-order that was
    // already BOOKED (has an AWB — e.g. PACKED before this cancel) must have its
    // shipment cancelled too, or the pickup stays live carrier-side while the
    // order is dead in our DB. The admin cancel path does this via
    // orders.sub_order.cancelled_by_admin → DelhiveryCancelHandler; the customer
    // path emits a customer-scoped twin that the SAME handler subscribes to.
    // Post-commit + best-effort: a courier/outbox hiccup must never un-cancel
    // the already-committed order. The handler no-ops for non-Delhivery / no-AWB
    // sub-orders, so emitting one event per sub-order is safe.
    for (const so of order.subOrders) {
      try {
        await this.eventBus.publish({
          eventName: 'orders.sub_order.cancelled_by_customer',
          aggregate: 'SubOrder',
          aggregateId: so.id,
          occurredAt: new Date(),
          payload: {
            subOrderId: so.id,
            orderNumber,
            customerId: userId,
            source: 'CUSTOMER',
          },
        });
      } catch (err) {
        // Order is already cancelled; a failed emit must not surface to the
        // customer. The stranded AWB is recoverable via reconciliation/ops.
        this.logger.error(
          `Failed to emit cancelled_by_customer for sub-order ${so.id} (order ${orderNumber}): ${
            (err as Error)?.message
          }`,
        );
      }
    }

    // Phase 197 (Checkout audit #11 / My-Orders audit #11) — compliance
    // audit row for the customer self-cancel. Best-effort: a failed
    // audit write must never block the cancel confirmation the customer
    // already earned.
    await this.audit
      .writeAuditLog({
        actorId: userId,
        actorRole: 'CUSTOMER',
        action: 'order.cancelled',
        module: 'checkout',
        resource: 'MasterOrder',
        resourceId: order.id,
        oldValue: { orderStatus: order.orderStatus, paymentStatus: order.paymentStatus },
        newValue: { orderStatus: 'CANCELLED', paymentStatus: 'CANCELLED' },
        metadata: { orderNumber: order.orderNumber, subOrderCount: order.subOrders.length },
      })
      .catch((err) =>
        this.logger.warn(
          `Audit write failed for order.cancelled ${order.id}: ${(err as Error).message}`,
        ),
      );

    return { success: true };
  }
}
