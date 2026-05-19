import { Injectable, Inject, Logger } from '@nestjs/common';
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
import { assertGatewayPaymentMatchesOrder } from '../../../../core/money/gateway-amount-verifier';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import { assertTransition } from '../../../../core/fsm/status-transitions';
import {
  CatalogPublicFacade,
  AllocationResult,
} from '../../../catalog/application/facades/catalog-public.facade';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';
import { DiscountPublicFacade } from '../../../discounts/application/facades/discount-public.facade';
import { ShippingOptionsPublicFacade } from '../../../shipping-options/application/facades/shipping-options-public.facade';
import { DiscountReservationService } from '../../../discounts/application/services/discount-reservation.service';
import { DiscountAllocationService } from '../../../discounts/application/services/discount-allocation.service';
// Phase 6 GST — TaxSnapshotService writes order_item_tax_snapshots +
// sub_order_tax_summaries + order_tax_summaries for EVERY order
// (with or without a discount applied). See docs/tax/CA.md §A.
import { TaxSnapshotService } from '../../../tax/application/services/tax-snapshot.service';
// Phase 30 — CheckoutTaxPreviewService returns the CGST/SGST/IGST
// breakdown for the pre-payment summary so the customer sees the
// same split the post-placement invoice will carry.
import {
  CheckoutTaxPreviewService,
  CheckoutTaxPreviewResult,
} from '../../../tax/application/services/checkout-tax-preview.service';
import {
  lookupStateCodeByName,
  buildStateIndex,
} from '../../../tax/domain/state-code-map';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AffiliatePublicFacade } from '../../../affiliate/application/facades/affiliate-public.facade';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { CodRuleEngine } from '../../../cod/application/services/cod-rule-engine.service';
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
  private readonly logger = new Logger(CheckoutService.name);

  // Phase 30 — lazy state-name → 2-digit-code index. Built once per
  // process lifetime from india_states (small, ~38 rows). Used to
  // map a free-text CustomerAddress.state ("Karnataka", "TAMIL NADU")
  // to the GST 2-digit code the tax engine expects.
  private stateIndexPromise: Promise<ReadonlyMap<string, string>> | null = null;

  constructor(
    @Inject(CHECKOUT_REPOSITORY)
    private readonly repo: ICheckoutRepository,
    private readonly sessionService: CheckoutSessionService,
    private readonly catalogFacade: CatalogPublicFacade,
    private readonly franchiseFacade: FranchisePublicFacade,
    private readonly discountFacade: DiscountPublicFacade,
    private readonly shippingOptionsFacade: ShippingOptionsPublicFacade,
    private readonly discountReservation: DiscountReservationService,
    private readonly discountAllocation: DiscountAllocationService,
    // Phase 6 GST.
    private readonly taxSnapshot: TaxSnapshotService,
    // Phase 30 GST.
    private readonly taxPreview: CheckoutTaxPreviewService,
    private readonly affiliateFacade: AffiliatePublicFacade,
    private readonly walletFacade: WalletPublicFacade,
    private readonly paymentOpsFacade: PaymentOpsFacade,
    private readonly razorpayAdapter: RazorpayAdapter,
    // Sprint 2 Story 1.4 — COD eligibility gate. The rule engine
    // auto-logs every evaluation to cod_decision_log, so there's no
    // need for a separate audit call here.
    private readonly codRuleEngine: CodRuleEngine,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    // Phase 7 (PR 7.6) — paise-sibling dual-write at every masterOrder
    // update site. The five sites in this file are all status/payment-
    // flag updates today (no money fields), so the helper no-ops, but
    // wiring at the call site keeps the apparatus visible and
    // future-proofs against payload changes (a totalAmount edit slipped
    // into a status-only update path was the original Phase 0 hazard).
    private readonly moneyDualWrite: MoneyDualWriteHelper,
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

    // 3. Release any existing reservations from a previous checkout attempt.
    //
    // Phase 4.2 (2026-05-16) — releases run in parallel via
    // Promise.allSettled so we don't pay 10-item-cart × per-call
    // latency sequentially. Each leg is best-effort: a reservation
    // that's already expired is harmless to "release" again
    // (idempotent at the facade level after the §4.4 race-safety
    // rewrite), and one bad reservation must not strand the others.
    const existingSession = await this.sessionService.get(userId);
    if (existingSession) {
      const releasers = existingSession.items.map((item) => {
        if (item.allocatedNodeType === 'FRANCHISE' && item.allocatedSellerId) {
          return this.franchiseFacade
            .unreserveStock(
              item.allocatedSellerId,
              item.productId,
              item.variantId,
              item.quantity,
            )
            .catch(() => {
              /* already expired */
            });
        }
        if (item.reservationId) {
          return this.catalogFacade
            .releaseReservation(item.reservationId)
            .catch(() => {
              /* already expired */
            });
        }
        return Promise.resolve();
      });
      await Promise.allSettled(releasers);
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

    // Phase 30 — compute the tax preview so the customer sees the
    // CGST/SGST/IGST split before paying. Best-effort: a failure
    // here must not block checkout — the response gracefully returns
    // `taxPreview: null` and the UI falls back to the prior
    // "GST: Included in price" string.
    let taxPreview: CheckoutTaxPreviewResult | null = null;
    try {
      const customerShippingStateCode =
        await this.resolveStateCodeFromAddressName(address.state);
      taxPreview = await this.taxPreview.previewForSession({
        items: session.items
          .filter((it) => it.serviceable)
          .map((it) => ({
            productId: it.productId,
            variantId: it.variantId,
            unitPriceInPaise: BigInt(
              Math.round(it.unitPrice * 100),
            ),
            quantity: it.quantity,
            sellerId: it.allocatedSellerId,
          })),
        customerShippingStateCode,
      });
    } catch (err) {
      this.logger.warn(
        `Checkout tax preview failed for user ${userId}: ` +
          `${(err as Error).message}. Returning checkout without preview.`,
      );
    }

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
        // Phase 30 — null when the preview failed; UI handles the
        // null-fallback string. Otherwise carries the BigInt-paise
        // breakdown serialised as decimal strings.
        taxPreview,
      },
    };
  }

  /**
   * Lazy-load the india_states name → code index. The table has ~38
   * rows so the in-memory cache is trivial; built once per process
   * lifetime.
   */
  private async getStateIndex(): Promise<ReadonlyMap<string, string>> {
    if (!this.stateIndexPromise) {
      this.stateIndexPromise = (async () => {
        const rows = await this.prisma.indiaState.findMany({
          where: { isActive: true },
          select: { gstStateCode: true, stateName: true },
        });
        return buildStateIndex(rows);
      })();
    }
    return this.stateIndexPromise;
  }

  private async resolveStateCodeFromAddressName(
    rawStateName: string | null | undefined,
  ): Promise<string | null> {
    if (!rawStateName) return null;
    // If the caller already stored a 2-digit code, accept it as-is.
    if (/^[0-9]{2}$/.test(rawStateName.trim())) {
      return rawStateName.trim();
    }
    const index = await this.getStateIndex();
    return lookupStateCodeByName(rawStateName, index);
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

    // Phase 30 — recompute the tax preview for the cached session
    // so refresh / direct-navigation hits also get the breakdown.
    // Best-effort; same null-fallback as initiateCheckout.
    let taxPreview: CheckoutTaxPreviewResult | null = null;
    try {
      const customerShippingStateCode =
        await this.resolveStateCodeFromAddressName(
          session.addressSnapshot.state,
        );
      taxPreview = await this.taxPreview.previewForSession({
        items: session.items
          .filter((it) => it.serviceable)
          .map((it) => ({
            productId: it.productId,
            variantId: it.variantId,
            unitPriceInPaise: BigInt(
              Math.round(it.unitPrice * 100),
            ),
            quantity: it.quantity,
            sellerId: it.allocatedSellerId,
          })),
        customerShippingStateCode,
      });
    } catch (err) {
      this.logger.warn(
        `getCheckoutSummary tax preview failed for user ${userId}: ` +
          `${(err as Error).message}`,
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
      taxPreview,
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
    shippingOptionId?: string | null,
    // Phase 37 — checkout B2B GSTIN picker. When the buyer has multiple
    // tax profiles and explicitly chose one, the ID is snapshotted on
    // MasterOrder and the tax-document service prefers it at invoice
    // time over the global default profile.
    selectedTaxProfileId?: string | null,
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
        shippingOptionId,
        selectedTaxProfileId,
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
    shippingOptionId?: string | null,
    selectedTaxProfileId?: string | null,
  ) {
    const method: 'COD' | 'ONLINE' =
      paymentMethod?.toUpperCase() === 'ONLINE' ? 'ONLINE' : 'COD';
    const session = await this.sessionService.get(userId);

    if (!session) {
      throw new NotFoundAppException(
        'No active checkout session — please initiate checkout first',
      );
    }

    // Phase 37 — when the buyer chose a specific B2B profile at
    // checkout, verify the row belongs to this customer before
    // snapshotting it. Silently dropping (rather than 400-ing) would
    // mean the user thinks they bought under GSTIN X but the invoice
    // came out under their default — bad surprise.
    if (selectedTaxProfileId) {
      const owns = await this.prisma.customerTaxProfile.findFirst({
        where: { id: selectedTaxProfileId, customerId: userId },
        select: { id: true },
      });
      if (!owns) {
        throw new BadRequestAppException(
          'Selected tax profile does not belong to this customer',
        );
      }
    }

    if (new Date(session.expiresAt) < new Date()) {
      await this.sessionService.delete(userId);
      throw new BadRequestAppException(
        'Checkout session has expired — please initiate checkout again',
      );
    }

    // Stamp the customer's chosen shipping option onto the session so
    // the downstream recompute (after discount resolves) sees it. The
    // caller may also pass null to clear it (e.g. picking "free").
    if (shippingOptionId !== undefined) {
      session.shippingOptionId = shippingOptionId;
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

    // Sprint 2 Story 1.4 — COD eligibility gate.
    // Run before any heavy work (allocation, payment-intent, etc.) so a
    // blocked pincode / customer / value gets a fast clean 400 and the
    // cart isn't half-mutated. CodRuleEngine writes the decision to
    // cod_decision_log internally — required for the SPRINT_PLAN exit
    // criterion ("COD evaluation logged"). Default = allow when no
    // rule matches, so an empty rules table doesn't break checkout.
    if (method === 'COD') {
      const pincode =
        (session.addressSnapshot as { postalCode?: string } | null)?.postalCode;
      if (!pincode) {
        throw new BadRequestAppException(
          'Cannot evaluate COD — address pincode missing from session',
        );
      }
      const orderTotalInr = session.items.reduce(
        (sum, it) => sum + (it.lineTotal ?? 0),
        0,
      );
      const eligibility = await this.codRuleEngine.evaluate({
        pincode,
        customerId: userId,
        orderTotalInr,
      });
      if (!eligibility.eligible) {
        throw new BadRequestAppException(
          `COD not available for this order: ${eligibility.reason ?? 'blocked by COD rule'}`,
        );
      }
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
    // Set when the customer applies a FREE_SHIPPING coupon. Zeros the
    // recomputed shipping fee further down (separate code path from
    // product-discount allocation).
    let freeShippingCouponApplied = false;
    // Phase B (P0.3) — reservation lifecycle handle. Set when the
    // allocation feature flag is on; null otherwise (legacy path).
    let discountReservationId: string | null = null;
    const allocationEnabled = this.env.getBoolean(
      'DISCOUNT_ALLOCATION_ENABLED',
      false,
    );
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
        // Phase E (P1.3) — eligibility context. Pass userId so
        // customer-scoped rules (FIRST_ORDER_ONLY, NEW_CUSTOMER,
        // velocity) can run; payment method + address (if shipping
        // city/pincode are surfaced from the session) light up
        // CITY_IN / PINCODE_IN / PAYMENT_METHOD_IN rules.
        {
          customerId: userId,
          paymentMethod: method,
          address: session.addressSnapshot
            ? {
                city: (session.addressSnapshot as any)?.city ?? null,
                pincode: (session.addressSnapshot as any)?.postalCode ?? null,
                state: (session.addressSnapshot as any)?.state ?? null,
              }
            : undefined,
        },
      );
      discountCode = resolved.code;
      discountAmount = resolved.discountAmount;
      discountId = resolved.discountId;
      // Track whether this coupon is a free-shipping coupon — used
      // below to zero the shipping fee after the regular recompute.
      if ((resolved as any).type === 'FREE_SHIPPING') {
        freeShippingCouponApplied = true;
      }

      // Phase B (P0.3, P0.4) — reserve a redemption slot before
      // committing the order. The reservation is concurrency-safe
      // (DB row lock + partial unique indexes) so this is the call
      // that enforces maxUses + onePerCustomer under load.
      if (allocationEnabled && discountId) {
        // Idempotency key must be UNIQUE PER CHECKOUT SESSION, not just
        // per customer-coupon pair. Otherwise the second order this
        // customer places with the same coupon returns the existing
        // REDEEMED redemption from their first order — allocation rows
        // then attach to a different masterOrder than the redemption.
        // session.createdAt is set once per /checkout/initiate call, so
        // it's stable across retries within the same checkout flow but
        // changes when the customer starts a fresh checkout.
        const idemKey = `checkout:${userId}:${discountId}:${trimmedCouponCode}:${session.createdAt}`;
        try {
          const reservation = await this.discountReservation.reserve({
            discountId,
            discountCode: trimmedCouponCode,
            customerId: userId,
            discountAmountInPaise: BigInt(Math.round(discountAmount * 100)),
            source: 'CODE',
            idempotencyKey: idemKey,
          });
          discountReservationId = reservation.redemptionId;
        } catch (err) {
          // Map service-layer errors to user-friendly messages.
          const reason = (err as any)?.reason;
          if (reason === 'MAX_USES_REACHED') {
            throw new BadRequestAppException(
              'This coupon has reached its usage limit.',
            );
          }
          if (reason === 'ALREADY_REDEEMED_BY_CUSTOMER') {
            throw new BadRequestAppException(
              'You have already used this coupon.',
            );
          }
          if (reason === 'EXPIRED') {
            throw new BadRequestAppException('This coupon has expired.');
          }
          if (reason === 'NOT_STARTED') {
            throw new BadRequestAppException(
              'This coupon is not active yet.',
            );
          }
          if (reason === 'INACTIVE' || reason === 'NOT_FOUND') {
            throw new BadRequestAppException(
              'This coupon is no longer available.',
            );
          }
          throw err;
        }
      }
    }
    // Shipping fee (v1) — server-side recompute. Frontend may suggest an
    // option via session.shippingOptionId, but the fee is recalculated
    // here using the current cart subtotal AFTER discount (so free-
    // shipping thresholds use the net amount). When no option is
    // selected (or none are configured), shipping is free — preserves
    // the legacy zero-fee behavior.
    let resolvedShippingOptionId: string | null = null;
    let resolvedShippingOptionName: string | null = null;
    let resolvedShippingFeeInPaise = 0n;
    const netCartPaise = BigInt(
      Math.max(0, Math.round((session.totalAmount - discountAmount) * 100)),
    );
    if (session.shippingOptionId) {
      try {
        const quote = await this.shippingOptionsFacade.quoteOption({
          optionId: session.shippingOptionId,
          netCartValueInPaise: netCartPaise,
        });
        resolvedShippingOptionId = quote.optionId;
        resolvedShippingOptionName = quote.name;
        resolvedShippingFeeInPaise = quote.feeInPaise;
      } catch (err) {
        // Disabled or deleted between preview and place-order. Surface
        // the service error verbatim — it carries the customer-friendly
        // message ("Please pick another option").
        throw new BadRequestAppException(
          (err as Error)?.message ??
            'Selected shipping option is unavailable.',
        );
      }
    }
    // FREE_SHIPPING coupon: wipe the shipping fee but keep the snapshot
    // (name + option id) so the order detail still shows which option
    // would have been charged.
    if (freeShippingCouponApplied) {
      resolvedShippingFeeInPaise = 0n;
    }
    const shippingFeeInRupees = Number(resolvedShippingFeeInPaise) / 100;
    const chargedTotal = Math.max(
      0,
      session.totalAmount - discountAmount + shippingFeeInRupees,
    );

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
        shippingOptionId: resolvedShippingOptionId,
        shippingOptionName: resolvedShippingOptionName,
        shippingFeeInPaise: resolvedShippingFeeInPaise,
        selectedTaxProfileId: selectedTaxProfileId ?? null,
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
      // Phase B (P0.3) — release the discount reservation so other
      // customers can use the coupon. Best-effort; the cron will
      // also pick up the row on its next sweep via TTL expiry.
      if (discountReservationId) {
        try {
          await this.discountReservation.release({
            redemptionId: discountReservationId,
            reason: 'CHECKOUT_FAILED',
          });
        } catch {
          // ignore — cron will catch via TTL
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
          data: this.moneyDualWrite.applyPaise('masterOrder', {
            orderStatus: 'CANCELLED',
            paymentStatus: 'CANCELLED',
          }),
        });
        throw new BadRequestAppException(
          `Wallet debit failed: ${(err as Error).message}. Order cancelled.`,
        );
      }
    }

    // Remove checkout session
    await this.sessionService.delete(userId);

    // Phase B (P0.1, P0.5) — allocation + ledger + redemption.
    //
    // When the allocation feature flag is ON: write the full per-item
    // discount allocation, GST snapshots, and liability ledger rows,
    // then mark the redemption REDEEMED. All in one transaction; on
    // failure the order is still committed (customer charged correctly,
    // MasterOrder.discountAmount preserved) but the per-item ledger
    // is missing — a recovery cron will retry.
    //
    // When the flag is OFF: legacy path — bump usedCount directly.
    if (discountId && allocationEnabled && discountReservationId) {
      try {
        await this.discountAllocation.allocateAndPersist({
          masterOrderId: result.masterOrderId,
          discountId,
          discountCode,
          redemptionId: discountReservationId,
          discountAmountInPaise: BigInt(Math.round(discountAmount * 100)),
          // For now we only support order-level percent/fixed via
          // checkout. BXGY allocation needs the resolved get-eligible
          // set passed in via DiscountPublicFacade.validateCouponForCheckout
          // — extending that response shape is a follow-up.
          discountType: 'AMOUNT_OFF_ORDER',
          discountMethod: 'CODE',
          source: 'CODE',
          // Default to PLATFORM funding for any existing discounts;
          // admin-discount form changes (Phase D) will let admins set
          // SELLER / SHARED before this is reached for new campaigns.
          funding: { fundingType: 'PLATFORM' },
        });
      } catch (err) {
        // Order is committed and customer was charged correctly.
        // Allocation rows are missing — log + emit an outbox event
        // for the recovery worker. Don't fail the response.
        // (See Phase E P1.1 for the recovery handler.)
        this.logger.error(
          `Discount allocation failed for order ${result.masterOrderId} ` +
          `(discountId=${discountId}, redemptionId=${discountReservationId}): ` +
          `${(err as Error)?.message}`,
          (err as Error)?.stack,
        );
        try {
          await this.eventBus.publish({
            eventName: 'discount.allocation.failed',
            aggregate: 'MasterOrder',
            aggregateId: result.masterOrderId,
            occurredAt: new Date(),
            payload: {
              masterOrderId: result.masterOrderId,
              discountId,
              redemptionId: discountReservationId,
              discountAmount,
              error: (err as Error)?.message,
            },
          });
        } catch {
          // best-effort — if outbox is also down, the operator will
          // see the order without allocation rows during reconciliation.
        }
      }
    } else if (discountId) {
      // Legacy path: just bump usedCount. Best-effort.
      try {
        await this.discountFacade.incrementUsedCount(discountId);
      } catch {
        // ignore — a retry path can be added later if needed
      }
    }

    // Phase 6 GST — write tax snapshots + per-sub-order + master
    // summaries for EVERY order, with or without a discount. Runs in
    // its own transaction; idempotent on retry (upserts on unique
    // keys). Failure is non-fatal — order is already committed and
    // customer was charged correctly; a recovery cron can re-run
    // snapshot creation (Phase 19 PDF retry already polls for missing
    // tax artefacts and triggers a retry).
    try {
      // Resolve tax treatment from the discount row if a discount was
      // applied; otherwise default PRE_SUPPLY_TRANSACTIONAL has no
      // effect (no allocation rows for the snapshot service to read).
      let taxTreatment: 'PRE_SUPPLY_TRANSACTIONAL' | 'POST_SUPPLY_LINKED' | 'POST_SUPPLY_UNLINKED' | 'DISPLAY_ONLY' =
        'PRE_SUPPLY_TRANSACTIONAL';
      if (discountId) {
        const dRow = await this.prisma.discount.findUnique({
          where: { id: discountId },
          select: { taxTreatment: true },
        });
        if (dRow?.taxTreatment) taxTreatment = dRow.taxTreatment;
      }
      await this.taxSnapshot.createSnapshotsForMasterOrder(
        result.masterOrderId,
        { taxTreatment },
      );
    } catch (err) {
      this.logger.error(
        `Tax snapshot creation failed for order ${result.masterOrderId}: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
      // Order proceeds; tax recovery cron handles missing snapshots.
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
          data: this.moneyDualWrite.applyPaise('masterOrder', {
            paymentStatus: 'PAID',
            orderStatus: 'PLACED',
          }),
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
        // Phase 0 (PR 0.5) — adapter takes BigInt paise. `payableInRupees`
        // is still a JS Number for now (chargedTotal is computed in
        // rupee arithmetic upstream); Phase 7 will route the whole
        // checkout pipeline through paise. The Math.round + BigInt
        // conversion is at least localised here and gone after Phase 7.
        // Phase 4 (PR 4.3) — idempotency key derived from
        // masterOrderId so a transient 5xx + retry dedupes at Razorpay
        // and produces one gateway order. Without this, a network
        // blip during checkout would produce two orphan orders, both
        // valid, both observable by the orphan-payment confirm cron.
        const razorpayOrder = await this.razorpayAdapter.createOrder({
          amountInPaise: BigInt(Math.round(payableInRupees * 100)),
          receipt: result.orderNumber,
          notes: {
            masterOrderId: result.masterOrderId,
            orderNumber: result.orderNumber,
            walletPaidPaise: String(walletDebitInPaise),
          },
          idempotencyKey: `checkout-order-${result.masterOrderId}`,
        });

        const paymentExpiresAt = new Date(
          Date.now() + PAYMENT_WINDOW_MINUTES * 60 * 1000,
        );

        await this.prisma.masterOrder.update({
          where: { id: result.masterOrderId },
          data: this.moneyDualWrite.applyPaise('masterOrder', {
            razorpayOrderId: razorpayOrder.providerOrderId,
            paymentExpiresAt,
          }),
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
            // Phase 0 (PR 0.5) — wire field `amount` is rupees for the
            // legacy frontend Razorpay widget call. Convert from the
            // adapter's BigInt paise. Phase 7 will switch the wire to
            // `amountInPaise` end-to-end and drop this branch.
            amount: Number(razorpayOrder.amountInPaise) / 100,
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
          data: this.moneyDualWrite.applyPaise('masterOrder', {
            orderStatus: 'CANCELLED',
            paymentStatus: 'CANCELLED',
          }),
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

    // Phase 0 (PR 0.1) — silent-money-loss guard. The HMAC above only
    // proves Razorpay emitted this (orderId, paymentId) pair. It does
    // NOT prove the captured amount matches the order total or that
    // the payment is fully captured. Without this, a hostile client
    // can submit a ₹1 payment for a ₹10,000 order with a valid
    // signature and flip the order to PAID. We re-fetch the payment
    // from Razorpay (the source of truth) and reject if the snapshot
    // doesn't match.
    let gatewayPayment: Awaited<ReturnType<RazorpayAdapter['getRawPayment']>>;
    try {
      gatewayPayment = await this.razorpayAdapter.getRawPayment(
        input.razorpayPaymentId,
      );
    } catch (err: any) {
      this.logger.error(
        `Razorpay fetchPayment failed for ${input.razorpayPaymentId}: ${err?.message ?? err}`,
      );
      this.paymentOpsFacade
        .recordAttempt({
          masterOrderId: order.id,
          orderNumber: order.orderNumber,
          kind: 'VERIFY_SIGNATURE',
          status: 'FAILURE',
          providerOrderId: input.razorpayOrderId,
          providerPaymentId: input.razorpayPaymentId,
          amountInPaise: Math.round(Number(order.totalAmount) * 100),
          failureReason: `fetchPayment failed: ${err?.message ?? 'unknown'}`,
        })
        .catch(() => undefined);
      throw new BadRequestAppException(
        'Payment verification failed — could not confirm with gateway. Please retry shortly.',
      );
    }

    try {
      assertGatewayPaymentMatchesOrder(gatewayPayment, {
        totalAmountInPaise: BigInt(order.totalAmountInPaise),
        razorpayOrderId: input.razorpayOrderId,
      });
    } catch (err: any) {
      this.paymentOpsFacade
        .recordAttempt({
          masterOrderId: order.id,
          orderNumber: order.orderNumber,
          kind: 'VERIFY_SIGNATURE',
          status: 'FAILURE',
          providerOrderId: input.razorpayOrderId,
          providerPaymentId: input.razorpayPaymentId,
          amountInPaise: gatewayPayment.amount,
          failureReason: err.message,
        })
        .catch(() => undefined);
      this.paymentOpsFacade
        .flagMismatch({
          kind: err.code === 'GATEWAY_AMOUNT_MISMATCH'
            ? 'AMOUNT_MISMATCH'
            : 'SIGNATURE_INVALID',
          masterOrderId: order.id,
          orderNumber: order.orderNumber,
          providerPaymentId: input.razorpayPaymentId,
          expectedInPaise: Number(order.totalAmountInPaise),
          actualInPaise: gatewayPayment.amount,
          severity: 95,
          description:
            `Gateway verification rejected for order ${order.orderNumber}: ${err.message} ` +
            `(razorpay_order ${input.razorpayOrderId}, payment ${input.razorpayPaymentId}).`,
        })
        .catch(() => undefined);
      throw err;
    }

    // Phase 0 (PR 0.8) — FSM check on both fields we're about to flip.
    // The `findFirst` above filtered on `orderStatus: PENDING_PAYMENT`,
    // but admin cancellation in `rejectOrder` can land between read
    // and write, leaving us about to resurrect a CANCELLED order. The
    // assertions throw before the update so the order stays cancelled.
    assertTransition('OrderStatus', order.orderStatus, 'PLACED');
    assertTransition('OrderPaymentStatus', order.paymentStatus, 'PAID');

    await this.prisma.masterOrder.update({
      where: { id: order.id },
      data: this.moneyDualWrite.applyPaise('masterOrder', {
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        razorpayPaymentId: input.razorpayPaymentId,
      }),
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

    // Create a new Razorpay order (previous one may have expired on Razorpay side).
    // Phase 0 (PR 0.5) — pass paise from the order's BigInt column
    // directly. This call site is now precision-safe end-to-end: the
    // value never enters a JS Number.
    const razorpayOrder = await this.razorpayAdapter.createOrder({
      amountInPaise: BigInt(order.totalAmountInPaise),
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
      data: this.moneyDualWrite.applyPaise('masterOrder', {
        razorpayOrderId: razorpayOrder.providerOrderId,
        paymentExpiresAt: newExpiry,
      }),
    });

    return {
      orderNumber: order.orderNumber,
      totalAmount: Number(order.totalAmount),
      payment: {
        razorpayOrderId: razorpayOrder.providerOrderId,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
        // Phase 0 (PR 0.5) — see comment on the equivalent block in
        // placeOrder above. Wire shape preserved for the soak window.
        amount: Number(razorpayOrder.amountInPaise) / 100,
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
