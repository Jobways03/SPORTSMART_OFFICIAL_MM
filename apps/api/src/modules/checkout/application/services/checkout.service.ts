import { Injectable, Inject } from '@nestjs/common';
import {
  CHECKOUT_REPOSITORY,
  ICheckoutRepository,
  CreateOrderItemInput,
  FulfillmentGroupInput,
} from '../../domain/repositories/checkout.repository.interface';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  CatalogPublicFacade,
  AllocationResult,
} from '../../../catalog/application/facades/catalog-public.facade';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';
import { DiscountPublicFacade } from '../../../discounts/application/facades/discount-public.facade';
import { AffiliatePublicFacade } from '../../../affiliate/application/facades/affiliate-public.facade';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import {
  CheckoutSessionService,
  CheckoutSession,
  CheckoutItemAllocation,
} from './checkout-session.service';
import * as crypto from 'crypto';

const PAYMENT_WINDOW_MINUTES = 30;
const PLACE_ORDER_LOCK_TTL_SECONDS = 30;

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(CHECKOUT_REPOSITORY)
    private readonly repo: ICheckoutRepository,
    private readonly sessionService: CheckoutSessionService,
    private readonly catalogFacade: CatalogPublicFacade,
    private readonly franchiseFacade: FranchisePublicFacade,
    private readonly discountFacade: DiscountPublicFacade,
    private readonly affiliateFacade: AffiliatePublicFacade,
    private readonly walletFacade: WalletPublicFacade,
    private readonly paymentOpsFacade: PaymentOpsFacade,
    private readonly razorpayAdapter: RazorpayAdapter,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
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
        try {
          if (item.allocatedNodeType === 'FRANCHISE' && item.allocatedSellerId) {
            // Franchise reservations are released via the franchise facade
            await this.franchiseFacade.unreserveStock(
              item.allocatedSellerId,
              item.productId,
              item.variantId,
              item.quantity,
            );
          } else if (item.reservationId) {
            await this.catalogFacade.releaseReservation(item.reservationId);
          }
        } catch {
          // Best-effort release — reservation may have expired already
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
        // Customer-facing price consolidates on `price` (variant) and
        // `basePrice` (product). platformPrice column is dropped.
        ? Number(cartItem.variant.price)
        : Number(cartItem.product.basePrice ?? 0);
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
          allocatedNodeType: 'SELLER',
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
          allocatedNodeType: 'SELLER',
          allocatedMappingId: null,
          estimatedDeliveryDays: null,
          reservationId: null,
        });
        unserviceableCount++;
        continue;
      }

      // Reserve stock — use the appropriate facade based on node type
      const primaryNodeType = allocation.primary.nodeType ?? 'SELLER';
      let reservationId: string | null = null;

      try {
        if (primaryNodeType === 'FRANCHISE') {
          // Franchise stock reservation via franchise facade
          const franchiseId = allocation.primary.franchiseId || allocation.primary.sellerId;
          await this.franchiseFacade.reserveStock(
            franchiseId,
            cartItem.productId,
            cartItem.variantId ?? null,
            cartItem.quantity,
          );
          // Franchise reservations are tracked via ledger — no reservationId
          reservationId = null;
        } else {
          // Seller stock reservation via catalog facade
          const reservation = await this.catalogFacade.reserveStock({
            mappingId: allocation.primary.mappingId,
            quantity: cartItem.quantity,
            expiresInMinutes: 15,
          });
          reservationId = reservation.id;
        }
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
          allocatedNodeType: 'SELLER',
          allocatedMappingId: null,
          estimatedDeliveryDays: null,
          reservationId: null,
        });
        unserviceableCount++;
        continue;
      }

      serviceableAmount += lineTotal;

      // Use franchiseId as the allocatedSellerId for franchise nodes
      const allocatedNodeId = primaryNodeType === 'FRANCHISE'
        ? (allocation.primary.franchiseId || allocation.primary.sellerId)
        : allocation.primary.sellerId;

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
        allocatedSellerId: allocatedNodeId,
        allocatedSellerName: allocation.primary.sellerName,
        allocatedNodeType: primaryNodeType,
        allocatedMappingId: allocation.primary.mappingId,
        estimatedDeliveryDays: allocation.primary.estimatedDeliveryDays,
        reservationId,
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

  async placeOrder(
    userId: string,
    paymentMethod?: string,
    couponCode?: string,
    referralCode?: string,
    walletApplyAmountInPaise?: number,
  ) {
    // Per-user lock: prevents double-submit (UI double-click or client
    // retry) from committing two MasterOrders against the same checkout
    // session. Without it, two concurrent calls both pass session.get()
    // and both run placeOrderTransaction, leaving an orphan order whose
    // reservationId is already CONFIRMED by the winning call.
    const lockKey = `lock:checkout:place-order:${userId}`;
    const acquired = await this.redis.acquireLock(
      lockKey,
      PLACE_ORDER_LOCK_TTL_SECONDS,
    );
    if (!acquired) {
      throw new BadRequestAppException(
        'Another order placement is in progress — please wait a moment and retry.',
      );
    }

    try {
      return await this.placeOrderLocked(
        userId,
        paymentMethod,
        couponCode,
        referralCode,
        walletApplyAmountInPaise,
      );
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  private async placeOrderLocked(
    userId: string,
    paymentMethod?: string,
    couponCode?: string,
    referralCode?: string,
    walletApplyAmountInPaise?: number,
  ) {
    const method: 'COD' | 'ONLINE' =
      paymentMethod?.toUpperCase() === 'ONLINE' ? 'ONLINE' : 'COD';
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

    // Group items by fulfillment node (nodeType + nodeId)
    const fulfillmentGroups: Record<string, FulfillmentGroupInput> = {};
    for (const item of session.items) {
      const nodeType = item.allocatedNodeType || 'SELLER';
      const nodeId = item.allocatedSellerId || 'unknown';
      const groupKey = `${nodeType}:${nodeId}`;
      if (!fulfillmentGroups[groupKey]) {
        fulfillmentGroups[groupKey] = {
          items: [],
          nodeName: item.allocatedSellerName,
          nodeType,
          nodeId,
        };
      }
      fulfillmentGroups[groupKey].items.push({
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

    // Snapshot franchise commission rates at order time
    for (const [_key, group] of Object.entries(fulfillmentGroups)) {
      if (group.nodeType === 'FRANCHISE') {
        const rate = await this.franchiseFacade.getCommissionRate(group.nodeId);
        group.commissionRateSnapshot = rate;
      }
    }

    // Re-validate coupon server-side against the session subtotal. Never
    // trust a client-reported discount amount — the only safe input from
    // the UI is the coupon code, which we resolve against the DB here.
    let discountCode: string | null = null;
    let discountAmount = 0;
    let discountId: string | null = null;
    const trimmedCouponCode = (couponCode || '').trim();
    if (trimmedCouponCode) {
      const sessionItems = session.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      }));
      const resolved = await this.discountFacade.validateCouponForCheckout(
        trimmedCouponCode,
        session.totalAmount,
        sessionItems,
      );
      discountCode = resolved.code;
      discountAmount = resolved.discountAmount;
      discountId = resolved.discountId;
    }
    const chargedTotal = Math.max(0, session.totalAmount - discountAmount);

    // Wallet preflight — clamp to chargedTotal (can't pay more than the
    // order is for) and verify the user has the balance. Done BEFORE the
    // order transaction so we fail fast without an orphan order.
    const walletDebitInPaise = Math.max(
      0,
      Math.min(
        Math.round((walletApplyAmountInPaise ?? 0)),
        Math.round(chargedTotal * 100),
      ),
    );
    const walletDebitInRupees = walletDebitInPaise / 100;
    const payableInRupees = Math.max(0, chargedTotal - walletDebitInRupees);
    if (walletDebitInPaise > 0) {
      const ok = await this.walletFacade.hasSufficientBalance(
        userId,
        walletDebitInPaise,
      );
      if (!ok) {
        throw new BadRequestAppException(
          'Wallet balance has changed — please refresh your cart and retry.',
        );
      }
    }

    // Affiliate attribution — resolved BEFORE the order transaction so
    // we can pass it through and persist the ReferralAttribution row
    // atomically with MasterOrder creation. Returns null when neither
    // the coupon nor the referral code maps to an active affiliate
    // (silent fall-through per SRS §6.2 + §7.5 — never an error).
    const attribution = await this.affiliateFacade.resolveAttribution({
      couponCode: trimmedCouponCode || null,
      referralCode: referralCode || null,
    });

    let result;
    try {
      result = await this.repo.placeOrderTransaction({
        customerId: userId,
        addressSnapshot: session.addressSnapshot,
        totalAmount: chargedTotal,
        itemCount: session.itemCount,
        paymentMethod: method,
        fulfillmentGroups,
        discountCode,
        discountAmount,
        affiliateAttribution: attribution,
      });
    } catch (err) {
      // Compensating action: release franchise reservations on failure
      // (Seller reservations have a TTL via StockReservation table and will auto-expire)
      for (const item of session.items) {
        if (item.allocatedNodeType === 'FRANCHISE' && item.allocatedSellerId) {
          try {
            await this.franchiseFacade.unreserveStock(
              item.allocatedSellerId,
              item.productId,
              item.variantId,
              item.quantity,
            );
          } catch {
            // Best-effort release; FranchiseReservationCleanupService will catch stragglers
          }
        }
      }
      throw err;
    }

    // Confirm all seller reservations (deducts from actual stockQty)
    // Franchise reservations are already deducted via the ledger at reserve time
    for (const item of session.items) {
      if (item.reservationId && item.allocatedNodeType !== 'FRANCHISE') {
        await this.catalogFacade.confirmReservation(
          item.reservationId,
          result.masterOrderId,
        );
      }
    }

    // Wallet debit — runs AFTER the order is committed so the ledger
    // entry references a real order id. If it fails (e.g. balance race
    // lost the optimistic-lock retry budget), cancel the order to keep
    // the system consistent. Stock + reservations were already confirmed
    // above, so we mark the order CANCELLED here rather than tearing
    // everything back down.
    if (walletDebitInPaise > 0) {
      try {
        await this.walletFacade.debitForCheckout({
          userId,
          amountInPaise: walletDebitInPaise,
          orderId: result.masterOrderId,
          description: `Order ${result.orderNumber} — wallet portion`,
        });
      } catch (err) {
        await this.prisma.masterOrder.update({
          where: { id: result.masterOrderId },
          data: { orderStatus: 'CANCELLED', paymentStatus: 'CANCELLED' },
        });
        throw new BadRequestAppException(
          `Wallet debit failed: ${(err as Error).message}. Order cancelled.`,
        );
      }
    }

    // Remove checkout session
    await this.sessionService.delete(userId);

    // Bump usedCount on the applied coupon. Best-effort; the order is
    // already committed so we don't fail placement if the increment fails.
    if (discountId) {
      try {
        await this.discountFacade.incrementUsedCount(discountId);
      } catch {
        // ignore — a retry path can be added later if needed
      }
    }

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
            franchiseId: so.franchiseId,
            fulfillmentNodeType: so.fulfillmentNodeType,
            nodeName: so.nodeName,
            subTotal: so.subTotal,
            itemCount: so.itemCount,
          },
        });
      }
    } catch {
      // Events are best-effort — do not fail the order if event publishing fails
    }

    // For ONLINE payments: create Razorpay order and return details for frontend.
    // The gateway charges only the *payable* portion — wallet has already
    // covered the rest. If wallet covers the full order (payable === 0),
    // we mark the order PAID immediately and skip the gateway round-trip.
    if (method === 'ONLINE') {
      if (payableInRupees <= 0) {
        await this.prisma.masterOrder.update({
          where: { id: result.masterOrderId },
          data: { paymentStatus: 'PAID', orderStatus: 'PLACED' },
        });
        return {
          orderNumber: result.orderNumber,
          totalAmount: result.totalAmount,
          walletPaidAmount: walletDebitInRupees,
          itemCount: result.itemCount,
          paymentMethod: 'ONLINE' as const,
          payment: { fullyCoveredByWallet: true as const },
        };
      }

      try {
        const razorpayOrder = await this.razorpayAdapter.createOrder({
          amountInr: payableInRupees,
          receipt: result.orderNumber,
          notes: {
            masterOrderId: result.masterOrderId,
            orderNumber: result.orderNumber,
            walletPaidPaise: String(walletDebitInPaise),
          },
        });

        const paymentExpiresAt = new Date(
          Date.now() + PAYMENT_WINDOW_MINUTES * 60 * 1000,
        );

        await this.prisma.masterOrder.update({
          where: { id: result.masterOrderId },
          data: {
            razorpayOrderId: razorpayOrder.providerOrderId,
            paymentExpiresAt,
          },
        });

        // Payment-ops: SUCCESS create-order attempt. Best-effort write
        // — failure to log must NOT break the checkout.
        this.paymentOpsFacade
          .recordAttempt({
            masterOrderId: result.masterOrderId,
            orderNumber: result.orderNumber,
            kind: 'CREATE_ORDER',
            status: 'SUCCESS',
            providerOrderId: razorpayOrder.providerOrderId,
            amountInPaise: Math.round(payableInRupees * 100),
          })
          .catch(() => undefined);

        return {
          orderNumber: result.orderNumber,
          totalAmount: result.totalAmount,
          walletPaidAmount: walletDebitInRupees,
          itemCount: result.itemCount,
          paymentMethod: 'ONLINE' as const,
          payment: {
            razorpayOrderId: razorpayOrder.providerOrderId,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            expiresAt: paymentExpiresAt.toISOString(),
          },
        };
      } catch (err) {
        // Payment-ops: FAILURE create-order attempt.
        this.paymentOpsFacade
          .recordAttempt({
            masterOrderId: result.masterOrderId,
            orderNumber: result.orderNumber,
            kind: 'CREATE_ORDER',
            status: 'FAILURE',
            amountInPaise: Math.round(payableInRupees * 100),
            failureReason: (err as Error).message,
          })
          .catch(() => undefined);

        // Compensating action: refund the wallet portion if we already
        // debited (best-effort — surfaces in admin wallet logs if it fails).
        if (walletDebitInPaise > 0) {
          try {
            await this.walletFacade.creditCheckoutCancellation({
              userId,
              amountInPaise: walletDebitInPaise,
              orderId: result.masterOrderId,
              reason: `Razorpay createOrder failed: ${(err as Error).message}`,
            });
          } catch {
            // ignore — admin will reconcile via wallet logs
          }
        }
        await this.prisma.masterOrder.update({
          where: { id: result.masterOrderId },
          data: { orderStatus: 'CANCELLED', paymentStatus: 'CANCELLED' },
        });
        throw new BadRequestAppException(
          `Payment initialization failed: ${(err as Error).message}. Order has been cancelled.`,
        );
      }
    }

    return {
      orderNumber: result.orderNumber,
      totalAmount: result.totalAmount,
      walletPaidAmount: walletDebitInRupees,
      itemCount: result.itemCount,
      paymentMethod: 'COD' as const,
    };
  }

  // ── Verify Online Payment ─────────────────────────────────────────────

  async verifyPayment(
    userId: string,
    input: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ) {
    const order = await this.prisma.masterOrder.findFirst({
      where: {
        customerId: userId,
        razorpayOrderId: input.razorpayOrderId,
        orderStatus: 'PENDING_PAYMENT',
      },
    });
    if (!order) {
      throw new NotFoundAppException(
        'No pending-payment order found for this Razorpay order',
      );
    }

    if (order.paymentExpiresAt && new Date() > order.paymentExpiresAt) {
      throw new BadRequestAppException(
        'Payment window has expired. Please place a new order.',
      );
    }

    // Razorpay verify-payment signature is HMAC-SHA256(orderId|paymentId)
    // keyed by the API key_secret. Fail closed if the secret is missing —
    // a blank key would let an attacker compute a valid HMAC themselves,
    // since hmac('', x) is deterministic and publicly reproducible. Prior
    // behaviour silently fell back to '' and accepted any "matching"
    // signature. Parallels the webhook signature verifier.
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      throw new BadRequestAppException(
        'Payment verification unavailable — gateway not configured',
      );
    }
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
      .digest('hex');

    // Constant-time compare — same rationale as the webhook verifier
    // (prevents byte-position timing leakage on the HMAC).
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const actualBuf = Buffer.from(input.razorpaySignature, 'utf8');
    const isValidSignature =
      expectedBuf.length === actualBuf.length &&
      crypto.timingSafeEqual(expectedBuf, actualBuf);
    if (!isValidSignature) {
      // Payment-ops: FAILURE verify + auto-create SIGNATURE_INVALID alert.
      // Both writes are fire-and-forget so they never block the throw.
      this.paymentOpsFacade
        .recordAttempt({
          masterOrderId: order.id,
          orderNumber: order.orderNumber,
          kind: 'VERIFY_SIGNATURE',
          status: 'FAILURE',
          providerOrderId: input.razorpayOrderId,
          providerPaymentId: input.razorpayPaymentId,
          amountInPaise: Math.round(Number(order.totalAmount) * 100),
          failureReason: 'HMAC signature mismatch',
        })
        .catch(() => undefined);
      this.paymentOpsFacade
        .flagMismatch({
          kind: 'SIGNATURE_INVALID',
          masterOrderId: order.id,
          orderNumber: order.orderNumber,
          providerPaymentId: input.razorpayPaymentId,
          severity: 90, // high — possible tampering / replay
          description:
            `Signature verification failed for order ${order.orderNumber} ` +
            `(razorpay_order ${input.razorpayOrderId}, payment ${input.razorpayPaymentId}). ` +
            `Computed HMAC did not match the signature provided.`,
        })
        .catch(() => undefined);
      throw new BadRequestAppException('Payment verification failed — invalid signature');
    }

    await this.prisma.masterOrder.update({
      where: { id: order.id },
      data: {
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        razorpayPaymentId: input.razorpayPaymentId,
      },
    });

    await this.prisma.subOrder.updateMany({
      where: { masterOrderId: order.id },
      data: { paymentStatus: 'PAID' },
    });

    // Payment-ops: SUCCESS verify-signature attempt.
    this.paymentOpsFacade
      .recordAttempt({
        masterOrderId: order.id,
        orderNumber: order.orderNumber,
        kind: 'VERIFY_SIGNATURE',
        status: 'SUCCESS',
        providerOrderId: input.razorpayOrderId,
        providerPaymentId: input.razorpayPaymentId,
        amountInPaise: Math.round(Number(order.totalAmount) * 100),
      })
      .catch(() => undefined);

    this.eventBus
      .publish({
        eventName: 'payments.payment.captured',
        aggregate: 'MasterOrder',
        aggregateId: order.id,
        occurredAt: new Date(),
        payload: {
          masterOrderId: order.id,
          orderNumber: order.orderNumber,
          customerId: userId,
          paymentId: input.razorpayPaymentId,
          amount: Number(order.totalAmount),
        },
      })
      .catch(() => {});

    return {
      verified: true,
      orderNumber: order.orderNumber,
      totalAmount: Number(order.totalAmount),
      paymentId: input.razorpayPaymentId,
    };
  }

  // ── Retry Payment ──────────────────────────────────────────────────────

  /**
   * Customer retries payment on a PENDING_PAYMENT order that hasn't expired.
   * Creates a fresh Razorpay order (idempotent — Razorpay allows multiple
   * orders for the same receipt) and returns new payment details.
   */
  async retryPayment(userId: string, orderNumber: string) {
    const order = await this.prisma.masterOrder.findFirst({
      where: {
        customerId: userId,
        orderNumber,
        orderStatus: 'PENDING_PAYMENT',
      },
    });
    if (!order) {
      throw new NotFoundAppException(
        'No pending-payment order found with this order number',
      );
    }

    if (order.paymentExpiresAt && new Date() > order.paymentExpiresAt) {
      throw new BadRequestAppException(
        'Payment window has expired. Please place a new order.',
      );
    }

    // Create a new Razorpay order (previous one may have expired on Razorpay side)
    const razorpayOrder = await this.razorpayAdapter.createOrder({
      amountInr: Number(order.totalAmount),
      receipt: order.orderNumber,
      notes: {
        masterOrderId: order.id,
        orderNumber: order.orderNumber,
        retry: 'true',
      },
    });

    // Extend the payment window
    const newExpiry = new Date(
      Date.now() + PAYMENT_WINDOW_MINUTES * 60 * 1000,
    );

    await this.prisma.masterOrder.update({
      where: { id: order.id },
      data: {
        razorpayOrderId: razorpayOrder.providerOrderId,
        paymentExpiresAt: newExpiry,
      },
    });

    return {
      orderNumber: order.orderNumber,
      totalAmount: Number(order.totalAmount),
      payment: {
        razorpayOrderId: razorpayOrder.providerOrderId,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        expiresAt: newExpiry.toISOString(),
      },
    };
  }

  // ── Public accessor for facade ─────────────────────────────────────────

  async getCheckoutSession(userId: string): Promise<CheckoutSession | null> {
    return this.sessionService.get(userId);
  }
}
