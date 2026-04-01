import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { UserAuthGuard } from '../../../core/guards';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../core/exceptions';
import {
  SellerAllocationService,
  AllocationResult,
  StockReservationResult,
} from '../../catalog/application/services/seller-allocation.service';
import { EventBusService } from '../../../bootstrap/events/event-bus.service';
import {
  CheckoutSessionService,
  CheckoutSession,
  CheckoutItemAllocation,
} from '../application/services/checkout-session.service';

@ApiTags('Checkout')
@Controller('customer/checkout')
@UseGuards(UserAuthGuard)
export class CheckoutController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: CheckoutSessionService,
    private readonly allocationService: SellerAllocationService,
    private readonly eventBus: EventBusService,
  ) {}

  // ── POST /customer/checkout/initiate ────────────────────────────────
  @Post('initiate')
  async initiateCheckout(
    @Req() req: any,
    @Body() body: { addressId: string },
  ) {
    const { addressId } = body;
    if (!addressId) {
      throw new BadRequestAppException('addressId is required');
    }

    // 1. Validate address and get pincode
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId: req.userId },
    });
    if (!address) {
      throw new NotFoundAppException('Address not found');
    }

    // 2. Get cart items
    const cart = await this.prisma.cart.findUnique({
      where: { customerId: req.userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                slug: true,
                basePrice: true,
                platformPrice: true,
                baseSku: true,
                hasVariants: true,
                status: true,
                images: {
                  where: { isPrimary: true },
                  select: { url: true },
                  take: 1,
                },
              },
            },
            variant: {
              select: {
                id: true,
                title: true,
                price: true,
                platformPrice: true,
                sku: true,
                status: true,
                images: {
                  select: { url: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestAppException('Cart is empty');
    }

    // 3. Release any existing reservations from a previous checkout attempt
    const existingSession = await this.sessionService.get(req.userId);
    if (existingSession) {
      for (const item of existingSession.items) {
        if (item.reservationId) {
          try {
            await this.allocationService.releaseReservation(item.reservationId);
          } catch {
            // Best-effort release — reservation may have expired already
          }
        }
      }
      await this.sessionService.delete(req.userId);
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
        allocation = await this.allocationService.allocate({
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
        // T8: Flag unserviceable items
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

      // T5: Reserve stock for allocated seller
      let reservation: StockReservationResult | null = null;
      try {
        reservation = await this.allocationService.reserveStock({
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
      customerId: req.userId,
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

    await this.sessionService.save(req.userId, session);

    return {
      success: true,
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

  // ── GET /customer/checkout/summary ──────────────────────────────────
  @Get('summary')
  async getCheckoutSummary(@Req() req: any) {
    const session = await this.sessionService.get(req.userId);

    if (!session) {
      throw new NotFoundAppException(
        'No active checkout session — please initiate checkout first',
      );
    }

    // Check if session has expired
    if (new Date(session.expiresAt) < new Date()) {
      await this.sessionService.delete(req.userId);
      throw new BadRequestAppException(
        'Checkout session has expired — please initiate checkout again',
      );
    }

    return {
      success: true,
      message: 'Checkout summary retrieved',
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

  // ── POST /customer/checkout/remove-unserviceable ────────────────────
  // T8: Allow removing unserviceable items from cart during checkout
  @Post('remove-unserviceable')
  async removeUnserviceableItems(@Req() req: any) {
    const session = await this.sessionService.get(req.userId);

    if (!session) {
      throw new NotFoundAppException(
        'No active checkout session — please initiate checkout first',
      );
    }

    if (new Date(session.expiresAt) < new Date()) {
      await this.sessionService.delete(req.userId);
      throw new BadRequestAppException(
        'Checkout session has expired — please initiate checkout again',
      );
    }

    const unserviceableItemIds = session.items
      .filter((i) => !i.serviceable)
      .map((i) => i.cartItemId);

    if (unserviceableItemIds.length === 0) {
      return {
        success: true,
        message: 'All items are already serviceable',
        data: { removedCount: 0 },
      };
    }

    // Remove from database cart
    await this.prisma.cartItem.deleteMany({
      where: { id: { in: unserviceableItemIds } },
    });

    // Update the session in-memory
    session.items = session.items.filter((i) => i.serviceable);
    session.totalAmount = session.serviceableAmount;
    session.itemCount = session.items.reduce((s, i) => s + i.quantity, 0);
    session.allServiceable = true;
    session.unserviceableCount = 0;

    await this.sessionService.save(req.userId, session);

    return {
      success: true,
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

  // ── POST /customer/checkout/place-order ─────────────────────────────
  // Converts the checkout session into a real MasterOrder + SubOrders
  @Post('place-order')
  async placeOrder(
    @Req() req: any,
    @Body() body: { paymentMethod?: string },
  ) {
    const session = await this.sessionService.get(req.userId);

    if (!session) {
      throw new NotFoundAppException(
        'No active checkout session — please initiate checkout first',
      );
    }

    if (new Date(session.expiresAt) < new Date()) {
      await this.sessionService.delete(req.userId);
      throw new BadRequestAppException(
        'Checkout session has expired — please initiate checkout again',
      );
    }

    // T8: Block if any item is unserviceable
    if (!session.allServiceable) {
      throw new BadRequestAppException(
        'Cannot place order — some items are unserviceable. Remove them first.',
      );
    }

    if (session.items.length === 0) {
      throw new BadRequestAppException('No items to order');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Generate order number (upsert ensures row always exists)
      const seq = await tx.orderSequence.upsert({
        where: { id: 1 },
        create: { id: 1, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const year = new Date().getFullYear();
      const orderNumber = `SM${year}${String(seq.lastNumber).padStart(4, '0')}`;

      // Create master order with status PLACED (awaits admin verification)
      const masterOrder = await tx.masterOrder.create({
        data: {
          orderNumber,
          customerId: req.userId,
          shippingAddressSnapshot: session.addressSnapshot,
          totalAmount: session.totalAmount,
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          orderStatus: 'PLACED',
          itemCount: session.itemCount,
        },
      });

      // Group items by allocated seller
      const sellerGroups: Record<string, CheckoutItemAllocation[]> = {};
      for (const item of session.items) {
        const sellerId = item.allocatedSellerId || 'unknown';
        if (!sellerGroups[sellerId]) sellerGroups[sellerId] = [];
        sellerGroups[sellerId].push(item);
      }

      // Create sub-orders per seller
      const createdSubOrders: Array<{ subOrderId: string; sellerId: string; sellerName: string | null; subTotal: number; itemCount: number }> = [];
      for (const [sellerId, items] of Object.entries(sellerGroups)) {
        let subTotal = 0;
        const orderItemsData = items.map((item) => {
          subTotal += item.lineTotal;
          return {
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
          };
        });

        const subOrder = await tx.subOrder.create({
          data: {
            masterOrderId: masterOrder.id,
            sellerId,
            subTotal,
            paymentStatus: 'PENDING',
            fulfillmentStatus: 'UNFULFILLED',
            acceptStatus: 'OPEN',
            items: { create: orderItemsData },
          },
        });

        createdSubOrders.push({
          subOrderId: subOrder.id,
          sellerId,
          sellerName: items[0]?.allocatedSellerName || null,
          subTotal,
          itemCount: items.reduce((s, i) => s + i.quantity, 0),
        });
      }

      // T5: Confirm all reservations (deducts from actual stockQty)
      for (const item of session.items) {
        if (item.reservationId) {
          await this.allocationService.confirmReservation(
            item.reservationId,
            masterOrder.id,
          );
        }
      }

      // Clear cart
      const cart = await tx.cart.findUnique({
        where: { customerId: req.userId },
      });
      if (cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      }

      return {
        orderNumber,
        masterOrderId: masterOrder.id,
        totalAmount: session.totalAmount,
        itemCount: session.itemCount,
        createdSubOrders,
      };
    });

    // Remove checkout session
    await this.sessionService.delete(req.userId);

    // T3: Publish domain events for order creation
    try {
      await this.eventBus.publish({
        eventName: 'orders.master.created',
        aggregate: 'MasterOrder',
        aggregateId: result.masterOrderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: result.masterOrderId,
          orderNumber: result.orderNumber,
          customerId: req.userId,
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
      success: true,
      message: 'Order placed successfully',
      data: {
        orderNumber: result.orderNumber,
        totalAmount: result.totalAmount,
        itemCount: result.itemCount,
      },
    };
  }
}
