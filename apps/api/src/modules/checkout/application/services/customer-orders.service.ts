import { Injectable, Inject, Logger } from '@nestjs/common';
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
