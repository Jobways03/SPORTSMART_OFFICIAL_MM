import { Injectable, Inject } from '@nestjs/common';
import {
  CHECKOUT_REPOSITORY,
  ICheckoutRepository,
  CreateOrderItemInput,
} from '../../domain/repositories/checkout.repository.interface';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  CatalogPublicFacade,
  AllocationResult,
  StockReservationResult,
} from '../../../catalog/application/facades/catalog-public.facade';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  CheckoutSessionService,
  CheckoutSession,
  CheckoutItemAllocation,
} from './checkout-session.service';

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(CHECKOUT_REPOSITORY)
    private readonly repo: ICheckoutRepository,
    private readonly sessionService: CheckoutSessionService,
    private readonly catalogFacade: CatalogPublicFacade,
    private readonly eventBus: EventBusService,
  ) {}

  // ── Initiate Checkout ──────────────────────────────────────────────────

  async initiateCheckout(
    userId: string,
    addressId: string,
  ) {
    if (!addressId) {
      throw new BadRequestAppException('addressId is required');
    }

    // 1. Validate address and get pincode
    const address = await this.repo.findAddressByIdAndCustomer(addressId, userId);
    if (!address) {
      throw new NotFoundAppException('Address not found');
    }

    // 2. Get cart items
    const cart = await this.repo.findCartWithCheckoutItems(userId);
    if (!cart || cart.items.length === 0) {
      throw new BadRequestAppException('Cart is empty');
    }

    // 3. Release any existing reservations from a previous checkout attempt
    const existingSession = await this.sessionService.get(userId);
    if (existingSession) {
      for (const item of existingSession.items) {
        if (item.reservationId) {
          try {
            await this.catalogFacade.releaseReservation(item.reservationId);
          } catch {
            // Best-effort release — reservation may have expired already
          }
        }
      }
      await this.sessionService.delete(userId);
    }

    // 4. Allocate sellers for each cart item
    const customerPincode = address.postalCode;
    const allocatedItems: CheckoutItemAllocation[] = [];
    let totalAmount = 0;
    let serviceableAmount = 0;
    let itemCount = 0;
    let unserviceableCount = 0;

    for (const cartItem of cart.items) {
      const unitPrice = cartItem.variant
        ? Number(cartItem.variant.platformPrice ?? cartItem.variant.price)
        : Number(cartItem.product.platformPrice ?? cartItem.product.basePrice ?? 0);
      const lineTotal = unitPrice * cartItem.quantity;
      totalAmount += lineTotal;
      itemCount += cartItem.quantity;

      const imageUrl =
        cartItem.variant?.images?.[0]?.url ||
        cartItem.product.images?.[0]?.url ||
        null;

      let allocation: AllocationResult;
      try {
        allocation = await this.catalogFacade.allocate({
          productId: cartItem.productId,
          variantId: cartItem.variantId ?? undefined,
          customerPincode,
          quantity: cartItem.quantity,
        });
      } catch {
        // If allocation throws (e.g., pincode not found), treat as unserviceable
        allocatedItems.push({
          cartItemId: cartItem.id,
          productId: cartItem.productId,
          variantId: cartItem.variantId,
          productTitle: cartItem.product.title,
          variantTitle: cartItem.variant?.title || null,
          imageUrl,
          sku: cartItem.variant?.sku || cartItem.product.baseSku || null,
          quantity: cartItem.quantity,
          unitPrice,
          lineTotal,
          serviceable: false,
          unserviceableReason: 'This item cannot be delivered to your address',
          allocatedSellerId: null,
          allocatedSellerName: null,
          allocatedMappingId: null,
          estimatedDeliveryDays: null,
          reservationId: null,
        });
        unserviceableCount++;
        continue;
      }

      if (!allocation.serviceable || !allocation.primary) {
        allocatedItems.push({
          cartItemId: cartItem.id,
          productId: cartItem.productId,
          variantId: cartItem.variantId,
          productTitle: cartItem.product.title,
          variantTitle: cartItem.variant?.title || null,
          imageUrl,
          sku: cartItem.variant?.sku || cartItem.product.baseSku || null,
          quantity: cartItem.quantity,
          unitPrice,
          lineTotal,
          serviceable: false,
          unserviceableReason: 'This item cannot be delivered to your address',
          allocatedSellerId: null,
          allocatedSellerName: null,
          allocatedMappingId: null,
          estimatedDeliveryDays: null,
          reservationId: null,
        });
        unserviceableCount++;
        continue;
      }

      // Reserve stock for allocated seller
      let reservation: StockReservationResult | null = null;
      try {
        reservation = await this.catalogFacade.reserveStock({
          mappingId: allocation.primary.mappingId,
          quantity: cartItem.quantity,
          expiresInMinutes: 15,
        });
      } catch {
        // Stock race condition — treat as unserviceable
        allocatedItems.push({
          cartItemId: cartItem.id,
          productId: cartItem.productId,
          variantId: cartItem.variantId,
          productTitle: cartItem.product.title,
          variantTitle: cartItem.variant?.title || null,
          imageUrl,
          sku: cartItem.variant?.sku || cartItem.product.baseSku || null,
          quantity: cartItem.quantity,
          unitPrice,
          lineTotal,
          serviceable: false,
          unserviceableReason: 'Stock just became unavailable — please try again',
          allocatedSellerId: null,
          allocatedSellerName: null,
          allocatedMappingId: null,
          estimatedDeliveryDays: null,
          reservationId: null,
        });
        unserviceableCount++;
        continue;
      }

      serviceableAmount += lineTotal;

      allocatedItems.push({
        cartItemId: cartItem.id,
        productId: cartItem.productId,
        variantId: cartItem.variantId,
        productTitle: cartItem.product.title,
        variantTitle: cartItem.variant?.title || null,
        imageUrl,
        sku: cartItem.variant?.sku || cartItem.product.baseSku || null,
        quantity: cartItem.quantity,
        unitPrice,
        lineTotal,
        serviceable: true,
        allocatedSellerId: allocation.primary.sellerId,
        allocatedSellerName: allocation.primary.sellerName,
        allocatedMappingId: allocation.primary.mappingId,
        estimatedDeliveryDays: allocation.primary.estimatedDeliveryDays,
        reservationId: reservation.id,
      });
    }

    // 5. Store checkout session in Redis (auto-expires via TTL)
    const session: CheckoutSession = {
      customerId: userId,
      addressId,
      addressSnapshot: {
        fullName: address.fullName,
        phone: address.phone,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
      },
      items: allocatedItems,
      totalAmount: Math.round(totalAmount * 100) / 100,
      serviceableAmount: Math.round(serviceableAmount * 100) / 100,
      itemCount,
      allServiceable: unserviceableCount === 0,
      unserviceableCount,
      createdAt: new Date().toISOString(),
      expiresAt: this.sessionService.buildExpiresAt(),
    };

    await this.sessionService.save(userId, session);

    return {
      message: unserviceableCount > 0
        ? `${unserviceableCount} item(s) cannot be delivered to your address`
        : 'Checkout initiated — stock reserved for 15 minutes',
      data: {
        items: session.items,
        totalAmount: session.totalAmount,
        serviceableAmount: session.serviceableAmount,
        itemCount: session.itemCount,
        allServiceable: session.allServiceable,
        unserviceableCount: session.unserviceableCount,
        addressSnapshot: session.addressSnapshot,
        expiresAt: session.expiresAt,
      },
    };
  }

  // ── Get Checkout Summary ───────────────────────────────────────────────

  async getCheckoutSummary(userId: string) {
    const session = await this.sessionService.get(userId);

    if (!session) {
      throw new NotFoundAppException(
        'No active checkout session — please initiate checkout first',
      );
    }

    // Check if session has expired
    if (new Date(session.expiresAt) < new Date()) {
      await this.sessionService.delete(userId);
      throw new BadRequestAppException(
        'Checkout session has expired — please initiate checkout again',
      );
    }

    return {
      items: session.items,
      totalAmount: session.totalAmount,
      serviceableAmount: session.serviceableAmount,
      itemCount: session.itemCount,
      allServiceable: session.allServiceable,
      unserviceableCount: session.unserviceableCount,
      addressSnapshot: session.addressSnapshot,
      expiresAt: session.expiresAt,
    };
  }

  // ── Remove Unserviceable Items ─────────────────────────────────────────

  async removeUnserviceableItems(userId: string) {
    const session = await this.sessionService.get(userId);

    if (!session) {
      throw new NotFoundAppException(
        'No active checkout session — please initiate checkout first',
      );
    }

    if (new Date(session.expiresAt) < new Date()) {
      await this.sessionService.delete(userId);
      throw new BadRequestAppException(
        'Checkout session has expired — please initiate checkout again',
      );
    }

    const unserviceableItemIds = session.items
      .filter((i) => !i.serviceable)
      .map((i) => i.cartItemId);

    if (unserviceableItemIds.length === 0) {
      return {
        message: 'All items are already serviceable',
        data: { removedCount: 0 },
      };
    }

    // Remove from database cart
    await this.repo.deleteCartItemsByIds(unserviceableItemIds);

    // Update the session in-memory
    session.items = session.items.filter((i) => i.serviceable);
    session.totalAmount = session.serviceableAmount;
    session.itemCount = session.items.reduce((s, i) => s + i.quantity, 0);
    session.allServiceable = true;
    session.unserviceableCount = 0;

    await this.sessionService.save(userId, session);

    return {
      message: `Removed ${unserviceableItemIds.length} unserviceable item(s) from cart`,
      data: {
        removedCount: unserviceableItemIds.length,
        items: session.items,
        totalAmount: session.totalAmount,
        itemCount: session.itemCount,
        allServiceable: session.allServiceable,
      },
    };
  }

  // ── Place Order ────────────────────────────────────────────────────────

  async placeOrder(userId: string, _paymentMethod?: string) {
    const session = await this.sessionService.get(userId);

    if (!session) {
      throw new NotFoundAppException(
        'No active checkout session — please initiate checkout first',
      );
    }

    if (new Date(session.expiresAt) < new Date()) {
      await this.sessionService.delete(userId);
      throw new BadRequestAppException(
        'Checkout session has expired — please initiate checkout again',
      );
    }

    // Block if any item is unserviceable
    if (!session.allServiceable) {
      throw new BadRequestAppException(
        'Cannot place order — some items are unserviceable. Remove them first.',
      );
    }

    if (session.items.length === 0) {
      throw new BadRequestAppException('No items to order');
    }

    // Group items by allocated seller
    const sellerGroups: Record<string, { items: CreateOrderItemInput[]; sellerName: string | null }> = {};
    for (const item of session.items) {
      const sellerId = item.allocatedSellerId || 'unknown';
      if (!sellerGroups[sellerId]) {
        sellerGroups[sellerId] = { items: [], sellerName: item.allocatedSellerName };
      }
      sellerGroups[sellerId].items.push({
        productId: item.productId,
        variantId: item.variantId,
        productTitle: item.productTitle,
        variantTitle: item.variantTitle,
        sku: item.sku,
        masterSku: item.sku,
        imageUrl: item.imageUrl,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        totalPrice: item.lineTotal,
      });
    }

    const result = await this.repo.placeOrderTransaction({
      customerId: userId,
      addressSnapshot: session.addressSnapshot,
      totalAmount: session.totalAmount,
      itemCount: session.itemCount,
      sellerGroups,
    });

    // Confirm all reservations (deducts from actual stockQty)
    for (const item of session.items) {
      if (item.reservationId) {
        await this.catalogFacade.confirmReservation(
          item.reservationId,
          result.masterOrderId,
        );
      }
    }

    // Remove checkout session
    await this.sessionService.delete(userId);

    // Publish domain events for order creation
    try {
      await this.eventBus.publish({
        eventName: 'orders.master.created',
        aggregate: 'MasterOrder',
        aggregateId: result.masterOrderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: result.masterOrderId,
          orderNumber: result.orderNumber,
          customerId: userId,
          totalAmount: result.totalAmount,
          itemCount: result.itemCount,
        },
      });

      for (const so of result.createdSubOrders) {
        await this.eventBus.publish({
          eventName: 'orders.sub_order.created',
          aggregate: 'SubOrder',
          aggregateId: so.subOrderId,
          occurredAt: new Date(),
          payload: {
            subOrderId: so.subOrderId,
            masterOrderId: result.masterOrderId,
            orderNumber: result.orderNumber,
            sellerId: so.sellerId,
            sellerName: so.sellerName,
            subTotal: so.subTotal,
            itemCount: so.itemCount,
          },
        });
      }
    } catch {
      // Events are best-effort — do not fail the order if event publishing fails
    }

    return {
      orderNumber: result.orderNumber,
      totalAmount: result.totalAmount,
      itemCount: result.itemCount,
    };
  }

  // ── Public accessor for facade ─────────────────────────────────────────

  async getCheckoutSession(userId: string): Promise<CheckoutSession | null> {
    return this.sessionService.get(userId);
  }
}
