import { createHash } from 'node:crypto';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
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
// Phase 69 (2026-05-22) — Phase 67 audit Gap #7. Used to resolve
// the commission rate for SELLER fulfillment groups at place-order
// time so SubOrder.commissionRateSnapshot carries the live rate;
// pre-Phase-69 only FRANCHISE groups got a snapshot, SELLER stayed
// null and settlement had to fall back to live CommissionSetting.
import { CommissionPublicFacade } from '../../../commission/application/facades/commission-public.facade';
import { DiscountPublicFacade } from '../../../discounts/application/facades/discount-public.facade';
import { ShippingOptionsPublicFacade } from '../../../shipping-options/application/facades/shipping-options-public.facade';
import { DiscountReservationService } from '../../../discounts/application/services/discount-reservation.service';
import { DiscountAllocationService } from '../../../discounts/application/services/discount-allocation.service';
// Phase 6 GST — TaxSnapshotService writes order_item_tax_snapshots +
// sub_order_tax_summaries + order_tax_summaries for EVERY order
// (with or without a discount applied). See docs/tax/CA.md §A.
import { TaxSnapshotService } from '../../../tax/application/services/tax-snapshot.service';
import { TaxPublicFacade } from '../../../tax/application/facades/tax-public.facade';
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
// Phase 70 (2026-05-22) — Phase 66 audit Gap #3/#10, Phase 67
// audit Gap #4. Payment entity scaffolding — shadow-write
// alongside the existing MasterOrder columns so a future-phase
// refactor can pivot read-side to Payment without backfill.
import { PaymentLifecycleService } from '../../../payments/application/services/payment-lifecycle.service';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
// Phase 69 (2026-05-22) — Phase 66 audit Gap #9 fix. Injecting the
// client gives a single test seam for the verify-payment signature
// path and the place-order key-id surfacing, instead of reaching
// for process.env directly from a service.
import { RazorpayClient } from '../../../../integrations/razorpay/clients/razorpay.client';
import { CodRuleEngine } from '../../../cod/application/services/cod-rule-engine.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { StockRestoreService } from '../../../orders/application/services/stock-restore.service';
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
    private readonly commissionFacade: CommissionPublicFacade,
    private readonly discountFacade: DiscountPublicFacade,
    private readonly shippingOptionsFacade: ShippingOptionsPublicFacade,
    private readonly discountReservation: DiscountReservationService,
    private readonly discountAllocation: DiscountAllocationService,
    // Phase 6 GST.
    private readonly taxSnapshot: TaxSnapshotService,
    // Phase 30 GST.
    private readonly taxPreview: CheckoutTaxPreviewService,
    // Phase 37 — read-side facade for the tax module. Used at place-order
    // time to validate that a buyer-picked CustomerTaxProfile.id actually
    // belongs to the buyer — checkout never reaches into the tax module's
    // customer_tax_profiles table directly.
    private readonly taxFacade: TaxPublicFacade,
    private readonly affiliateFacade: AffiliatePublicFacade,
    private readonly walletFacade: WalletPublicFacade,
    private readonly paymentOpsFacade: PaymentOpsFacade,
    private readonly razorpayAdapter: RazorpayAdapter,
    // Phase 69 (2026-05-22) — Phase 66 audit Gap #9. RazorpayClient
    // is the canonical config surface (key id, key secret,
    // isConfigured). Pre-Phase-69 verifyPayment + the place-order
    // ONLINE branch each had their own `process.env.RAZORPAY_*`
    // reads — same env path, but two boundary crossings to test
    // through.
    private readonly razorpayClient: RazorpayClient,
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
    // Follow-up #H8 — used to release confirmed stock when wallet
    // debit fails after the order has been committed. Without this,
    // the order is cancelled but the stock stays deducted.
    private readonly stockRestore: StockRestoreService,
    // Phase 67 (2026-05-22) — audit log on order placement (audit
    // Gap #25). Pre-Phase-67 there was no unified compliance trail
    // for "who placed what, when". Each successful place-order now
    // writes an audit row with actor=customerId, action=order.placed,
    // newValue=order summary, metadata={paymentMethod, total, ...}.
    private readonly auditFacade: AuditPublicFacade,
    // Phase 70 (2026-05-22) — Payment entity scaffolding.
    private readonly paymentLifecycle: PaymentLifecycleService,
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
              // Phase 159p (audit #3) — pass the reservation correlation id so
              // the ORDER_UNRESERVE ledger row matches the original
              // ORDER_RESERVE; the sweeper's follow-up check then skips this
              // (already-released) abandoned reservation instead of releasing
              // it a second time.
              item.reservationId ?? undefined,
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

    // Phase 44 (2026-05-21) — re-resolve pricing tiers server-side at
    // checkout time. Pre-Phase-44 checkout used raw variant.price /
    // basePrice, so order totals diverged from the cart whenever a
    // tier qualified. We always recompute (never trust the cart's
    // snapshot) because quantity could have changed between cart-add
    // and checkout — the snapshot would be stale.
    const tierBatch = await this.catalogFacade.resolveBatchUnitPrices(
      cart.items.map((it: any) => ({
        productId: it.productId,
        variantId: it.variantId ?? null,
        quantity: it.quantity,
        listUnitPrice: it.variant
          ? Number(it.variant.price)
          : Number(it.product.basePrice ?? 0),
      })),
    );

    for (let idx = 0; idx < cart.items.length; idx++) {
      const cartItem = cart.items[idx]!;
      const pricing = tierBatch[idx]!;
      const unitPrice = pricing.effectiveUnitPrice;
      const lineTotal = Math.round(unitPrice * cartItem.quantity * 100) / 100;
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
        // Phase 64 (audit Gap #16) — typed reason for diagnostics.
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
          unserviceableCode: 'NO_MAPPING',
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
        // Phase 64 (audit Gap #16) — surface the allocator's typed
        // reason so the UI + support can diagnose. Customer-facing
        // copy stays English; the code travels alongside.
        const reasonCopy: Record<string, string> = {
          OUT_OF_STOCK: 'Stock just became unavailable for this address',
          NO_SERVICE_AREA: 'Your pincode is not in this seller\'s service area',
          DISTANCE_EXCEEDED: 'No sellers nearby can deliver to your address',
          PRODUCT_INACTIVE: 'This product is no longer available',
          VARIANT_INACTIVE: 'This variant is no longer available',
          PINCODE_UNKNOWN: 'Please check your pincode — we couldn\'t find it',
          NO_MAPPING: 'This item cannot be delivered to your address',
        };
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
          unserviceableReason:
            reasonCopy[allocation.reason] ||
            'This item cannot be delivered to your address',
          unserviceableCode: allocation.reason,
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
          // Franchise stock reservation via franchise facade.
          //
          // Phase 159p (audit #3) — give the franchise reservation a stable
          // correlation id. The franchise side journals reservations as ledger
          // rows (no StockReservation entity), and pre-159p the reserve row's
          // referenceId was null. That left the sweeper cron unable to tell a
          // committed order's hold from an abandoned cart: it correlated
          // ORDER_RESERVE→follow-up by referenceId, but reserve(null) never
          // matched ship/cancel(orderId), and a paid-but-unshipped order had no
          // follow-up at all — so the cron released committed holds (oversell).
          // We now stamp this id as the reserve row's referenceId AND (at
          // placeOrder) onto OrderItem.stockReservationId, so the cron can see
          // the reservation belongs to a placed order and leave it alone.
          const franchiseId = allocation.primary.franchiseId || allocation.primary.sellerId;
          const franchiseReservationId = crypto.randomUUID();
          await this.franchiseFacade.reserveStock(
            franchiseId,
            cartItem.productId,
            cartItem.variantId ?? null,
            cartItem.quantity,
            franchiseReservationId,
          );
          reservationId = franchiseReservationId;
        } else {
          // Seller stock reservation. Phase 77 (2026-05-22) —
          // allocator audit Gap #11. Pre-Phase-77 checkout did
          // `allocate` then `reserveStock` against the chosen
          // mapping. The window between snapshot and reserve let
          // another customer race-grab the primary; this code's
          // catch block surfaced RACE_LOST without falling
          // through to secondary/tertiary. Switching to
          // `allocateAndReserve` closes the window — it tries
          // primary → secondary → tertiary → fallback under
          // row-locked tx, only surfacing RACE_LOST when ALL
          // ranked candidates are exhausted.
          //
          // The trade-off: `allocateAndReserve` re-runs `allocate`
          // internally. The wasted ~50ms is worth the race-safety
          // for a hot path that's already running on the order
          // critical path.
          const aar = await this.catalogFacade.allocateAndReserve({
            productId: cartItem.productId,
            variantId: cartItem.variantId ?? undefined,
            customerPincode,
            quantity: cartItem.quantity,
            expiresInMinutes: 15,
            customerId: userId,
          });
          reservationId = aar.reservation.id;
          // The chosen candidate may differ from the original
          // allocation.primary if a race-fallback happened. The
          // line-item snapshot below uses `aar.chosenCandidate`
          // as the source of truth.
          allocation.primary = aar.chosenCandidate;
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
          unserviceableCode: 'RACE_LOST',
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
        // Phase 44 (2026-05-21) — propagate pricing-tier snapshot
        // through to order placement so OrderItem rows can capture
        // the tier applied at billing time.
        appliedPricingTierId: pricing.appliedTierId,
        appliedDiscountPercent: pricing.appliedDiscountPercent,
        appliedFixedUnitPrice: pricing.appliedFixedUnitPrice,
        appliedListUnitPrice: pricing.listUnitPrice,
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
        // Phase 63 (2026-05-22) — snapshot now carries every
        // visible address field so order detail can render the
        // full address without re-joining customer_addresses
        // (which may be soft-deleted or edited) and the tax
        // engine doesn't re-resolve stateCode by name (audit
        // Gap #7).
        locality: (address as any).locality ?? null,
        landmark: (address as any).landmark ?? null,
        addressType: (address as any).addressType ?? null,
        city: address.city,
        state: address.state,
        stateCode: (address as any).stateCode ?? null,
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

    // Phase 64 (audit Gap #10) — re-check serviceability against
    // the LIVE allocator before deleting. Pre-Phase-64 the service
    // trusted the stale session snapshot — if a seller re-activated
    // a mapping between checkout-initiate and remove-unserviceable
    // the customer's items were wiped from cart based on outdated
    // state. The re-check ensures we only delete items that are
    // STILL unserviceable at the current pincode.
    const customerPincode = (session.addressSnapshot as any)?.postalCode as
      | string
      | undefined;
    const staleUnserviceable = session.items.filter((i) => !i.serviceable);
    const stillUnserviceableIds: string[] = [];
    if (customerPincode && staleUnserviceable.length > 0) {
      const recheck = await Promise.all(
        staleUnserviceable.map((item) =>
          this.catalogFacade
            .previewServiceability({
              productId: item.productId,
              variantId: item.variantId ?? undefined,
              customerPincode,
              quantity: item.quantity,
            })
            .catch(() => null),
        ),
      );
      staleUnserviceable.forEach((item, idx) => {
        const result = recheck[idx];
        // Only mark for deletion if still unserviceable (or
        // re-check itself failed — defensive default).
        if (!result || !result.serviceable) {
          stillUnserviceableIds.push(item.cartItemId);
        }
      });
    } else if (staleUnserviceable.length > 0) {
      // No pincode (shouldn't happen with valid session) — fall
      // back to legacy behaviour.
      stillUnserviceableIds.push(
        ...staleUnserviceable.map((i) => i.cartItemId),
      );
    }

    if (stillUnserviceableIds.length === 0) {
      return {
        message: 'All items are already serviceable',
        data: { removedCount: 0 },
      };
    }

    // Phase 64 (audit Gap #11) — wrap the DB delete + session save
    // so a failure on the save doesn't leave the DB cart and the
    // session out of sync. If the save fails after the delete, we
    // surface a 5xx and log the inconsistency rather than silently
    // returning success.
    try {
      await this.repo.deleteCartItemsByIds(stillUnserviceableIds);
    } catch (err) {
      this.logger.error(
        `Cart delete failed during removeUnserviceableItems for ${userId}: ${(err as Error).message}`,
      );
      throw err;
    }

    // Update the session in-memory to match the new DB state.
    const removedSet = new Set(stillUnserviceableIds);
    session.items = session.items.filter((i) => !removedSet.has(i.cartItemId));
    // Recompute totals from the remaining items (audit Gap #11
    // mitigation — don't reuse the stale `serviceableAmount` since
    // some items may have been re-serviceable and stayed).
    session.totalAmount = session.items
      .filter((i) => i.serviceable)
      .reduce((s, i) => s + i.lineTotal, 0);
    session.serviceableAmount = session.totalAmount;
    session.itemCount = session.items.reduce((s, i) => s + i.quantity, 0);
    session.allServiceable = session.items.every((i) => i.serviceable);
    session.unserviceableCount = session.items.filter((i) => !i.serviceable).length;

    try {
      await this.sessionService.save(userId, session);
    } catch (err) {
      // Phase 64 (audit Gap #11) — DB delete already committed; if
      // session save fails the customer's next read returns stale
      // session state (still listing removed items). Surface 5xx so
      // the client knows to refetch.
      this.logger.error(
        `Session save failed after cart delete for ${userId}: ${(err as Error).message}. ` +
          `DB cart has been updated; client must refetch session.`,
      );
      throw err;
    }
    const unserviceableItemIds = stillUnserviceableIds;

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
    // Phase 66 (audit Gap #13) — strict validation. The DTO at the
    // controller layer enforces enum membership, but the service is
    // also reachable from internal callers (admin tools, jobs); so
    // we keep a defence-in-depth check here. Pre-Phase-66 any value
    // other than (case-insensitive) 'ONLINE' silently mapped to COD.
    const rawMethod = paymentMethod?.toUpperCase();
    if (rawMethod && rawMethod !== 'COD' && rawMethod !== 'ONLINE') {
      throw new BadRequestAppException(
        `Unsupported paymentMethod "${paymentMethod}". Expected COD or ONLINE.`,
      );
    }
    // Phase 66 (audit Gap #12) — honor the ALLOW_ONLINE_PAYMENTS
    // env. When set to false, fall back to COD even if the caller
    // requested ONLINE.
    const onlineAllowed =
      (process.env.ALLOW_ONLINE_PAYMENTS ?? 'true').toLowerCase() !== 'false';
    const method: 'COD' | 'ONLINE' =
      rawMethod === 'ONLINE' && onlineAllowed ? 'ONLINE' : 'COD';
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
    // came out under their default — bad surprise. Routed via the
    // TaxPublicFacade so checkout doesn't read the tax module's
    // customer_tax_profiles table directly.
    if (selectedTaxProfileId) {
      const owns = await this.taxFacade.customerOwnsTaxProfile(
        userId,
        selectedTaxProfileId,
      );
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
        // Phase 44 (2026-05-21) — propagate the pricing-tier snapshot
        // from the checkout-session item through to placeOrder.
        appliedPricingTierId: item.appliedPricingTierId ?? null,
        appliedDiscountPercent: item.appliedDiscountPercent ?? null,
        appliedFixedUnitPrice: item.appliedFixedUnitPrice ?? null,
        appliedListUnitPrice: item.appliedListUnitPrice ?? null,
      });
    }

    // Snapshot per-node commission rates at order time.
    //
    // Phase 69 (2026-05-22) — Phase 67 audit Gap #7. SELLER groups
    // now also pull a rate (from the platform-wide CommissionSetting
    // via CommissionPublicFacade). Pre-Phase-69 only FRANCHISE
    // groups got a snapshot; SELLER stayed null and settlement
    // re-read live CommissionSetting at process time, drifting if
    // an admin edited the rate between order placement and
    // commission lock. A null result (boot race / settings row
    // missing) leaves the column null so the legacy fallback path
    // still works.
    for (const [_key, group] of Object.entries(fulfillmentGroups)) {
      if (group.nodeType === 'FRANCHISE') {
        const rate = await this.franchiseFacade.getCommissionRate(group.nodeId);
        group.commissionRateSnapshot = rate;
      } else if (group.nodeType === 'SELLER') {
        const rate = await this.commissionFacade.getCommissionRateForSeller(group.nodeId);
        group.commissionRateSnapshot = rate;
        // Phase 75 (2026-05-22) — Phase 73 reject-flow audit Gap #25.
        // Per-seller accept SLA. Pre-Phase-75 every sub-order got
        // the same 24h deadline. Now read from Seller.acceptSlaHours;
        // null falls back to the platform default (24h) handled by
        // the repo's ACCEPT_SLA_HOURS_DEFAULT.
        const seller = await this.prisma.seller.findUnique({
          where: { id: group.nodeId },
          select: { acceptSlaHours: true },
        });
        if (seller?.acceptSlaHours && seller.acceptSlaHours >= 1 && seller.acceptSlaHours <= 168) {
          group.acceptSlaHours = seller.acceptSlaHours;
        }
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
        // Phase 62 (2026-05-22) — when the resolved Discount carries
        // an affiliateId (unified affiliate coupon), tag the
        // reservation + allocation with source='AFFILIATE' (audit
        // Gap #16). Pre-Phase-62 every redemption was source='CODE',
        // so reporting couldn't tell affiliate-driven redemptions
        // from regular ones.
        const discountRow = await this.prisma.discount.findUnique({
          where: { id: discountId },
          select: { affiliateId: true },
        });
        const reservationSource: 'CODE' | 'AFFILIATE' = discountRow?.affiliateId
          ? 'AFFILIATE'
          : 'CODE';
        try {
          const reservation = await this.discountReservation.reserve({
            discountId,
            discountCode: trimmedCouponCode,
            customerId: userId,
            discountAmountInPaise: BigInt(Math.round(discountAmount * 100)),
            source: reservationSource,
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
      // Phase 62 (2026-05-22) — self-referral guard (audit Gap #1).
      // The facade compares this against affiliate.userId and silently
      // drops attribution when they match, so an affiliate cannot
      // bank commission on their own order.
      customerId: userId,
    });

    // Phase 67 (audit Gap #3) — deterministic idempotency key.
    // sha-256(customerId|session.createdAt) is stable across replicas
    // and across retries within the same checkout flow (a fresh
    // /checkout/initiate mints a new session.createdAt so a deliberate
    // "place another order" path doesn't collide). The repo's
    // findUnique fast-path + DB partial unique index together make
    // any retry — regardless of @Idempotent cache state — resolve
    // to the original order rather than a duplicate.
    const masterOrderIdempotencyKey = createHash('sha256')
      .update(`${userId}|${new Date(session.createdAt).toISOString()}`)
      .digest('hex');

    // Phase 67 (audit Gap #9) — source-cart linkage. Best-effort:
    // we read the cart row id before the order tx so we can stamp
    // it onto MasterOrder.sourceCartId. The repo also backfills if
    // we didn't pre-resolve.
    let sourceCartId: string | null = null;
    try {
      const cart = await this.prisma.cart.findUnique({
        where: { customerId: userId },
        select: { id: true },
      });
      sourceCartId = cart?.id ?? null;
    } catch {
      // forensic field — never fail the order
    }

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
        // Phase 62 — customerId threaded through for perUserLimit
        // enforcement + self-referral backstop (audit Gaps #1 + #3).
        affiliateAttribution: attribution
          ? { ...attribution, customerId: userId }
          : null,
        shippingOptionId: resolvedShippingOptionId,
        shippingOptionName: resolvedShippingOptionName,
        shippingFeeInPaise: resolvedShippingFeeInPaise,
        selectedTaxProfileId: selectedTaxProfileId ?? null,
        // Phase 67 (audit Gaps #3 + #9).
        idempotencyKey: masterOrderIdempotencyKey,
        sourceCartId,
      });
    } catch (err) {
      // Phase 67 (audit Gap #3) — idempotency-conflict recovery.
      // The repo throws IDEMPOTENCY_CONFLICT when the partial
      // unique index catches a concurrent winner; we re-read the
      // existing order and return its summary. Stock confirm /
      // wallet debit / Razorpay create-order were already done
      // by the original placement, so we must not re-fire them.
      if ((err as any)?.code === 'IDEMPOTENCY_CONFLICT') {
        const existing = await this.repo.findOrderByIdempotencyKey(
          masterOrderIdempotencyKey,
        );
        if (existing) {
          this.logger.warn(
            `Idempotency conflict resolved for user ${userId}; returning existing order ${existing.orderNumber}`,
          );
          // Release discount reservation just in case the conflict
          // path leaked it (best-effort).
          if (discountReservationId) {
            try {
              await this.discountReservation.release({
                redemptionId: discountReservationId,
                reason: 'CHECKOUT_FAILED',
              });
            } catch { /* ignore */ }
          }
          return {
            orderNumber: existing.orderNumber,
            totalAmount: existing.totalAmount,
            walletPaidAmount: 0,
            itemCount: existing.itemCount,
            paymentMethod: method,
            idempotencyReplay: true,
          };
        }
        // findOrderByIdempotencyKey miss is an impossible state (the
        // conflict only fires when a row with that key exists). Fall
        // through to the generic handler.
      }
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
              // Phase 159p (audit #3) — correlation id so the release matches
              // the reserve row for the sweeper's follow-up check.
              item.reservationId ?? undefined,
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
    // Franchise reservations are already deducted via the ledger at reserve time.
    //
    // Phase 67 (audit Gaps #2 + #10) — partial-failure resilience:
    //   • Each confirmation tracks success/failure so we don't pretend
    //     all stock confirmed when item N+1 onward threw.
    //   • The (orderItemId → reservationId) map feeds
    //     linkStockReservationsToOrderItems so refund-by-item has a
    //     direct FK-style pointer (Gap #10 fix).
    //   • A partial failure cancels the order + best-effort restores
    //     the successfully-confirmed reservations instead of leaving
    //     a half-confirmed order in PLACED state.
    const orderItemReservationMap: Record<string, string> = {};
    const confirmedReservationIds: string[] = [];
    let stockConfirmError: Error | null = null;
    // Map: index in session.items → orderItemId. We need to know the
    // OrderItem id per session item so the FK linkage can be written.
    // Build it by re-reading the order items in (subOrder, line-order).
    const orderItemsForLinkage = await this.prisma.orderItem.findMany({
      where: { subOrder: { masterOrderId: result.masterOrderId } },
      select: { id: true, productId: true, variantId: true, quantity: true, subOrderId: true },
    });
    for (let i = 0; i < session.items.length; i++) {
      const item = session.items[i];
      if (!item) continue;
      if (!item.reservationId) continue;

      // Phase 159p (audit #3) — franchise reservations have no StockReservation
      // entity to "confirm" (they're ledger rows), so we skip confirmReservation
      // for them. But we DO stamp the correlation id onto the matching OrderItem
      // (same link map the seller path uses) so the sweeper cron can tell this
      // hold belongs to a placed order and won't release it. No
      // confirmedReservationIds push: stockRestore.restoreForReservation is a
      // seller-StockReservation operation and would not apply.
      if (item.allocatedNodeType === 'FRANCHISE') {
        const match = orderItemsForLinkage.find(
          (oi) =>
            oi.productId === item.productId &&
            (oi.variantId ?? null) === (item.variantId ?? null) &&
            oi.quantity === item.quantity &&
            !Object.values(orderItemReservationMap).includes(item.reservationId!) &&
            !orderItemReservationMap[oi.id],
        );
        if (match) {
          orderItemReservationMap[match.id] = item.reservationId;
        }
        continue;
      }
      try {
        await this.catalogFacade.confirmReservation(
          item.reservationId,
          result.masterOrderId,
        );
        confirmedReservationIds.push(item.reservationId);
        // Match the first not-yet-mapped OrderItem with the same
        // (productId, variantId, quantity). Bounded by line count.
        const match = orderItemsForLinkage.find(
          (oi) =>
            oi.productId === item.productId &&
            (oi.variantId ?? null) === (item.variantId ?? null) &&
            oi.quantity === item.quantity &&
            !Object.values(orderItemReservationMap).includes(item.reservationId!) &&
            !orderItemReservationMap[oi.id],
        );
        if (match) {
          orderItemReservationMap[match.id] = item.reservationId;
        }
      } catch (err) {
        stockConfirmError = err as Error;
        this.logger.error(
          `Stock confirmation failed for reservation ${item.reservationId} on order ${result.masterOrderId} (item ${i + 1}/${session.items.length}): ${(err as Error).message}`,
        );
        break;
      }
    }

    // Phase 67 (audit Gap #2) — partial confirmation rollback.
    // If any seller confirmation failed, cancel the order and undo
    // the confirmations that already succeeded. Without this the
    // order stayed PLACED with phantom stock consumption on items
    // 1..N-1.
    if (stockConfirmError) {
      await this.prisma.$transaction(async (tx) => {
        await tx.masterOrder.update({
          where: { id: result.masterOrderId },
          data: this.moneyDualWrite.applyPaise('masterOrder', {
            orderStatus: 'CANCELLED',
            paymentStatus: 'CANCELLED',
          }),
        });
        for (const reservationId of confirmedReservationIds) {
          try {
            await this.stockRestore.restoreForReservation(tx, reservationId);
          } catch (restoreErr) {
            this.logger.warn(
              `Stock-restore failed for reservation ${reservationId} on order ${result.masterOrderId}: ${(restoreErr as Error).message}`,
            );
          }
        }
      });
      // Release the discount reservation too — order is dead.
      if (discountReservationId) {
        try {
          await this.discountReservation.release({
            redemptionId: discountReservationId,
            reason: 'CHECKOUT_FAILED',
          });
        } catch { /* ignore */ }
      }
      throw new BadRequestAppException(
        `Stock confirmation failed: ${stockConfirmError.message}. Order has been cancelled.`,
      );
    }

    // Phase 67 (audit Gap #10) — stamp the reservation id back onto
    // each OrderItem so refund-by-item has a direct pointer. Best-
    // effort: a failure here doesn't unwind the order (refunds can
    // still derive via the older mappingId lookup).
    if (Object.keys(orderItemReservationMap).length > 0) {
      try {
        await this.repo.linkStockReservationsToOrderItems(
          result.masterOrderId,
          orderItemReservationMap,
        );
      } catch (err) {
        this.logger.warn(
          `linkStockReservationsToOrderItems failed for ${result.masterOrderId}: ${(err as Error).message}`,
        );
      }
    }

    // Wallet debit — runs AFTER the order is committed so the ledger
    // entry references a real order id. If it fails (e.g. balance race
    // lost the optimistic-lock retry budget), cancel the order AND
    // restore the stock that was just confirmed above. Pre-Follow-up
    // #H8, the cancel happened but the stock stayed deducted, leaving
    // the catalog ledger short until manual cleanup.
    if (walletDebitInPaise > 0) {
      try {
        await this.walletFacade.debitForCheckout({
          userId,
          amountInPaise: walletDebitInPaise,
          orderId: result.masterOrderId,
          description: `Order ${result.orderNumber} — wallet portion`,
        });
      } catch (err) {
        // Follow-up #H8 — flip the order status + restore stock atomically.
        // Seller reservations were CONFIRMED above (lines 963-970), so
        // `restoreForReservation` undoes both the stockQty + variant.stock
        // decrements. Franchise items had their stock deducted at reserve
        // time and need an explicit `unreserveStock` to release.
        await this.prisma.$transaction(async (tx) => {
          await tx.masterOrder.update({
            where: { id: result.masterOrderId },
            data: this.moneyDualWrite.applyPaise('masterOrder', {
              orderStatus: 'CANCELLED',
              paymentStatus: 'CANCELLED',
            }),
          });
          for (const item of session.items) {
            if (item.allocatedNodeType === 'FRANCHISE') continue;
            if (!item.reservationId) continue;
            try {
              await this.stockRestore.restoreForReservation(
                tx,
                item.reservationId,
              );
            } catch (restoreErr) {
              // Log + continue: a partial restore is still better than no
              // restore, and the cron sweepers will catch stragglers.
              this.logger.warn(
                `H8 stock-restore failed for reservation ${item.reservationId} on order ${result.masterOrderId}: ${
                  (restoreErr as Error).message
                }`,
              );
            }
          }
        });

        // Franchise reservations release outside the tx — the franchise
        // facade owns its own transaction boundary. Best-effort; the
        // FranchiseReservationCleanupService picks up stragglers.
        for (const item of session.items) {
          if (item.allocatedNodeType !== 'FRANCHISE') continue;
          if (!item.allocatedSellerId) continue;
          try {
            await this.franchiseFacade.unreserveStock(
              item.allocatedSellerId,
              item.productId,
              item.variantId,
              item.quantity,
              // Phase 159p (audit #3) — correlation id so the release matches
              // the reserve row for the sweeper's follow-up check.
              item.reservationId ?? undefined,
            );
          } catch (unrErr) {
            this.logger.warn(
              `H8 franchise unreserve failed for order ${result.masterOrderId}: ${
                (unrErr as Error).message
              }`,
            );
          }
        }

        throw new BadRequestAppException(
          `Wallet debit failed: ${(err as Error).message}. Order cancelled and stock restored.`,
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
          // Phase 62 — pass through the affiliate-aware source so
          // allocation rows + ledger entries carry the right tag
          // (audit Gap #16). Re-read here because the reservation
          // branch's local var is out of scope.
          source: await (async () => {
            const d = await this.prisma.discount.findUnique({
              where: { id: discountId },
              select: { affiliateId: true },
            });
            return d?.affiliateId ? 'AFFILIATE' as const : 'CODE' as const;
          })(),
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
        await this.finalizeAndAuditOrder({
          masterOrderId: result.masterOrderId,
          orderNumber: result.orderNumber,
          userId,
          paymentMethod: method,
          chargedTotal: result.totalAmount,
          walletPaidAmount: walletDebitInRupees,
          discountCode,
          discountAmount,
          itemCount: result.itemCount,
        });
        // Phase 70 — wallet covered the entire order; no gateway
        // round-trip. Shadow row records the captured wallet payment.
        await this.paymentLifecycle.recordWalletOnlyPayment({
          masterOrderId: result.masterOrderId,
          amountInPaise: BigInt(walletDebitInPaise),
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
        //
        // Phase 66 (2026-05-22) — deterministic idempotency key
        // (audit Gap #7). Pre-Phase-66 the key was
        // `checkout-order-${masterOrderId}`; masterOrderId is minted
        // inside the order tx, so a retry that fired past
        // @Idempotent's TTL on a fresh replica generated a NEW
        // masterOrderId → NEW Razorpay key → second gateway order.
        // The new key is hash(customerId + session.createdAt +
        // orderNumber) — deterministic across replicas since both
        // session.createdAt (set at /checkout/initiate) and
        // orderNumber (generated upstream of this code path) are
        // stable for the same checkout flow.
        const idempotencyMaterial = `${userId}|${session.createdAt}|${result.orderNumber}`;
        const idempotencyKey = `checkout-order-${createHash('sha256')
          .update(idempotencyMaterial)
          .digest('hex')
          .slice(0, 40)}`;
        const razorpayOrder = await this.razorpayAdapter.createOrder({
          amountInPaise: BigInt(Math.round(payableInRupees * 100)),
          receipt: result.orderNumber,
          notes: {
            masterOrderId: result.masterOrderId,
            orderNumber: result.orderNumber,
            walletPaidPaise: String(walletDebitInPaise),
          },
          idempotencyKey,
        });

        // Phase 66 (audit Gap #25) — currency invariant. Razorpay
        // shouldn't return anything other than 'INR' for our
        // platform, but a gateway response divergence would
        // otherwise be invisible until customer-facing. Surface
        // as a CURRENCY_MISMATCH alert and treat as soft failure
        // (the createOrder amount check still applies; this is
        // belt-and-braces).
        if (
          razorpayOrder.currency &&
          razorpayOrder.currency.toUpperCase() !== 'INR'
        ) {
          this.paymentOpsFacade
            .flagMismatch({
              kind: 'CURRENCY_MISMATCH',
              severity: 90,
              masterOrderId: result.masterOrderId,
              orderNumber: result.orderNumber,
              expectedInPaise: BigInt(Math.round(payableInRupees * 100)),
              actualInPaise: BigInt(Math.round(payableInRupees * 100)),
              description: `Razorpay returned currency=${razorpayOrder.currency} for INR order ${result.orderNumber}`,
              providerPaymentId: null,
            })
            .catch(() => undefined);
        }

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

        // Phase 70 — shadow Payment row for the ONLINE gateway path.
        await this.paymentLifecycle.recordOnlinePaymentCreated({
          masterOrderId: result.masterOrderId,
          amountInPaise: BigInt(Math.round(payableInRupees * 100)),
          providerOrderId: razorpayOrder.providerOrderId,
          idempotencyKey,
          expiresAt: paymentExpiresAt,
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

        await this.finalizeAndAuditOrder({
          masterOrderId: result.masterOrderId,
          orderNumber: result.orderNumber,
          userId,
          paymentMethod: method,
          chargedTotal: result.totalAmount,
          walletPaidAmount: walletDebitInRupees,
          discountCode,
          discountAmount,
          itemCount: result.itemCount,
        });
        return {
          orderNumber: result.orderNumber,
          totalAmount: result.totalAmount,
          walletPaidAmount: walletDebitInRupees,
          itemCount: result.itemCount,
          paymentMethod: 'ONLINE' as const,
          payment: {
            razorpayOrderId: razorpayOrder.providerOrderId,
            razorpayKeyId: this.razorpayClient.getKeyId(),
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

        // Compensating action: refund the wallet portion if we
        // already debited. Phase 70 (2026-05-22) — Phase 66 audit
        // Gap #8: enqueue through the saga primitive so a transient
        // failure is automatically retried by the cron. Pre-Phase-70
        // this was a try/catch with swallowed error — a failed
        // refund left the customer debited with no audit trail.
        // The saga writes a row before the credit attempt, marks
        // COMPLETED on success, FAILED + attempts++ on error, and
        // the cron retries up to MAX_ATTEMPTS before emitting
        // wallet.refund_saga.abandoned for finance.
        if (walletDebitInPaise > 0) {
          try {
            await this.walletFacade.enqueueCheckoutCancellationRefund({
              customerId: userId,
              orderId: result.masterOrderId,
              amountInPaise: walletDebitInPaise,
              reason: `Razorpay createOrder failed: ${(err as Error).message}`,
            });
          } catch (sagaErr) {
            // Saga enqueue itself failing is extreme (DB outage); log
            // loudly so an operator can manually replay later.
            this.logger.error(
              `Wallet refund saga enqueue failed for order ${result.masterOrderId}: ${(sagaErr as Error).message}`,
            );
          }
        }
        await this.prisma.masterOrder.update({
          where: { id: result.masterOrderId },
          data: this.moneyDualWrite.applyPaise('masterOrder', {
            orderStatus: 'CANCELLED',
            paymentStatus: 'CANCELLED',
          }),
        });
        // Phase 70 — shadow Payment row flips to CANCELLED.
        await this.paymentLifecycle.markTerminal({
          masterOrderId: result.masterOrderId,
          status: 'CANCELLED',
        });
        throw new BadRequestAppException(
          `Payment initialization failed: ${(err as Error).message}. Order has been cancelled.`,
        );
      }
    }

    await this.finalizeAndAuditOrder({
      masterOrderId: result.masterOrderId,
      orderNumber: result.orderNumber,
      userId,
      paymentMethod: method,
      chargedTotal: result.totalAmount,
      walletPaidAmount: walletDebitInRupees,
      discountCode,
      discountAmount,
      itemCount: result.itemCount,
    });

    // Phase 70 — shadow Payment row for COD.
    await this.paymentLifecycle.recordCodPayment({
      masterOrderId: result.masterOrderId,
      amountInPaise: BigInt(Math.round(result.totalAmount * 100)),
    });

    return {
      orderNumber: result.orderNumber,
      totalAmount: result.totalAmount,
      walletPaidAmount: walletDebitInRupees,
      itemCount: result.itemCount,
      paymentMethod: 'COD' as const,
    };
  }

  // Phase 67 (audit Gaps #1 + #5 + #25) — single side-effect helper
  // called at every successful place-order exit. Two responsibilities:
  //   1. Flip MasterOrder.finalizedAt so listing/detail queries (and
  //      the future recovery cron) can distinguish "tx committed,
  //      side effects done" from "tx committed, side effects stuck".
  //   2. Write an audit_logs row with actor=customerId,
  //      action=order.placed. Provides the unified compliance trail
  //      the audit (Gap #25) called for; pre-Phase-67 only address
  //      / KYC changes hit the audit log, so order activity was
  //      reconstructable only from email + Razorpay logs.
  //
  // Both calls are best-effort: a failure to finalize / write audit
  // must not break the customer's order confirmation. The recovery
  // cron picks up un-finalized orders for ops review.
  private async finalizeAndAuditOrder(input: {
    masterOrderId: string;
    orderNumber: string;
    userId: string;
    paymentMethod: 'COD' | 'ONLINE';
    chargedTotal: number;
    walletPaidAmount: number;
    discountCode: string | null;
    discountAmount: number;
    itemCount: number;
  }): Promise<void> {
    try {
      await this.repo.markOrderFinalized(input.masterOrderId);
    } catch (err) {
      this.logger.warn(
        `markOrderFinalized failed for ${input.masterOrderId}: ${(err as Error).message}`,
      );
    }
    try {
      await this.auditFacade.writeAuditLog({
        actorId: input.userId,
        actorRole: 'CUSTOMER',
        action: 'order.placed',
        module: 'checkout',
        resource: 'MasterOrder',
        resourceId: input.masterOrderId,
        newValue: {
          orderNumber: input.orderNumber,
          paymentMethod: input.paymentMethod,
          totalAmount: input.chargedTotal,
          walletPaid: input.walletPaidAmount,
          itemCount: input.itemCount,
          discountCode: input.discountCode,
          discountAmount: input.discountAmount,
        },
      });
    } catch (err) {
      this.logger.warn(
        `audit log write failed for order ${input.masterOrderId}: ${(err as Error).message}`,
      );
    }
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
    //
    // Phase 69 (2026-05-22) — Phase 66 audit Gap #9. Key secret comes
    // from the injected RazorpayClient now, not process.env directly.
    // Same env, same fail-closed branch, but one boundary for tests
    // to override.
    const keySecret = this.razorpayClient.getKeySecret();
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

    // Phase 68 (audit Gap #13) — stamp the verification SLA deadline
    // when the order actually becomes PLACED. ONLINE orders sit in
    // PENDING_PAYMENT until verify-payment; the verification clock
    // should start from PAID, not from create.
    const verificationSlaMinutes = Math.max(
      1,
      Number(process.env.VERIFICATION_SLA_MINUTES ?? 60),
    );
    const verificationDeadlineAt = new Date(
      Date.now() + verificationSlaMinutes * 60 * 1000,
    );

    await this.prisma.masterOrder.update({
      where: { id: order.id },
      data: this.moneyDualWrite.applyPaise('masterOrder', {
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        razorpayPaymentId: input.razorpayPaymentId,
        verificationDeadlineAt,
      }),
    });

    await this.prisma.subOrder.updateMany({
      where: { masterOrderId: order.id },
      data: { paymentStatus: 'PAID' },
    });

    // Phase 70 — Payment shadow row flips to CAPTURED.
    await this.paymentLifecycle.markCaptured({
      providerOrderId: input.razorpayOrderId,
      providerPaymentId: input.razorpayPaymentId,
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
        razorpayKeyId: this.razorpayClient.getKeyId(),
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
