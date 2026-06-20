import { createHash } from 'node:crypto';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  CHECKOUT_REPOSITORY,
  ICheckoutRepository,
  PlaceOrderTransactionResult,
  PlaceOrderTransactionInput,
  CreateOrderItemInput,
  FulfillmentGroupInput,
} from '../../domain/repositories/checkout.repository.interface';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  assertGatewayPaymentMatchesOrder,
  resolveExpectedGatewayPaise,
} from '../../../../core/money/gateway-amount-verifier';
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
// Option B (Phase 2) — deferred ONLINE order creation (flag-gated).
import { DeferredOrderService } from './deferred-order.service';
// Prisma CheckoutSession aliased — `CheckoutSession` already names the Redis
// session interface in this file (the deferred intent is the Postgres model).
import type { CheckoutSession as DeferredCheckoutSession } from '@prisma/client';
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
import { CodPublicFacade } from '../../../cod/application/facades/cod-public.facade';
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
    // Per-seller COD eligibility (SELLER_DENY, seller-active, serviceability,
    // value min/max, abuse counter). Used at place-order to gate COD per
    // fulfillment node, not just once at cart level.
    private readonly codFacade: CodPublicFacade,
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
    // Option B (Phase 2) — deferred ONLINE order creation (flag-gated; the
    // legacy create-then-pay path stays the default until the flag is flipped).
    private readonly deferredOrderService: DeferredOrderService,
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

    for (let idx = 0; idx < cart.items.length; idx++) {
      const cartItem = cart.items[idx]!;
      const unitPrice = cartItem.variant
        ? Number(cartItem.variant.price)
        : Number(cartItem.product.basePrice ?? 0);
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

      // Reserve stock with CROSS-TIER FALLBACK (2026-06-16). `allocate()` returns
      // `allEligible` in cascade priority order (Retail → Franchise → D2C); we
      // walk it and reserve the FIRST candidate whose stock is still available,
      // reserving sellers and franchises through their respective facades. This
      // self-heals a race where the primary's stock is grabbed between the
      // allocation snapshot and the reserve — falling to the rest of the winning
      // tier first, then the lower tiers — instead of hard-failing the line while
      // a viable node still exists. (Replaces the old seller-only
      // `allocateAndReserve` + single-shot franchise branch, which had no
      // cross-tier fallback.)
      let reservationId: string | null = null;
      let reservedCandidate: typeof allocation.primary | null = null;
      const reserveChain =
        allocation.allEligible && allocation.allEligible.length > 0
          ? allocation.allEligible
          : [allocation.primary];

      try {
        for (const candidate of reserveChain) {
          try {
            if ((candidate.nodeType ?? 'SELLER') === 'FRANCHISE') {
              // Franchise stock — journaled as ledger rows (no StockReservation
              // entity). Stamp a stable correlation id as the reserve row's
              // referenceId so the abandoned-cart sweeper can tell a placed
              // order's hold from a cart hold (Phase 159p), and so placeOrder can
              // pin it onto OrderItem.stockReservationId.
              const franchiseId = candidate.franchiseId || candidate.sellerId;
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
              // Seller stock — row-locked reserve primitive; throws on a race
              // (insufficient stock / vanished mapping) so we fall through to
              // the next candidate.
              const reservation = await this.catalogFacade.reserveStock({
                mappingId: candidate.mappingId,
                quantity: cartItem.quantity,
                expiresInMinutes: 15,
                customerId: userId,
              });
              reservationId = reservation.id;
            }
            reservedCandidate = candidate;
            break; // reserved successfully — stop walking the chain
          } catch (err) {
            // A stock race / missing node → try the next candidate in the
            // cascade. The seller reserve primitive throws ConflictAppException
            // on insufficient stock; the FRANCHISE reserve path throws
            // BadRequestAppException for the same "lost the stock race" signal
            // (FranchiseInventoryService.reserveStock + the under-lock
            // over-reservation guard) — so it MUST be retryable too, else a
            // franchise primary losing a race would abort the whole cascade
            // instead of falling through to D2C. NotFoundAppException covers a
            // vanished node. Anything else is unexpected → bubble to the outer
            // catch (treated as unserviceable, preserving prior behaviour).
            if (
              err instanceof ConflictAppException ||
              err instanceof BadRequestAppException ||
              err instanceof NotFoundAppException
            ) {
              continue;
            }
            throw err;
          }
        }

        if (!reservedCandidate || !reservationId) {
          // Every candidate across all tiers lost the race / had no stock.
          throw new ConflictAppException('RACE_LOST');
        }

        if (reservedCandidate !== allocation.primary) {
          this.logger.warn(
            `checkout reserve fell back across the cascade to ` +
              `${reservedCandidate.tier}/${reservedCandidate.nodeType} ` +
              `${reservedCandidate.sellerId} for product=${cartItem.productId}`,
          );
        }
        // The reserved node may differ from the original primary after a
        // fallback — make it the source of truth for the line-item snapshot.
        allocation.primary = reservedCandidate;
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

      // Re-derive the node type from the RESERVED primary — a cross-tier
      // fallback may have changed it from the originally-allocated node.
      const primaryNodeType = allocation.primary.nodeType ?? 'SELLER';
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

      // Order-level value guardrails (env). The rule engine has a VALUE_LIMIT
      // (max) rule type but NO minimum rule type, so the configured
      // COD_FALLBACK_MIN_ORDER_VALUE_INR was never enforced at checkout — a ₹1
      // COD order slipped through. Enforce both bounds for EVERY COD cart
      // (covers franchise-only carts, where the per-seller facade loop below
      // doesn't run).
      const codMaxInr = this.env.getNumber('COD_FALLBACK_MAX_ORDER_VALUE_INR', 10000);
      const codMinInr = this.env.getNumber('COD_FALLBACK_MIN_ORDER_VALUE_INR', 100);
      if (orderTotalInr < codMinInr) {
        throw new BadRequestAppException(
          `COD is not available below ₹${codMinInr}. Please pay online for smaller orders.`,
        );
      }
      if (orderTotalInr > codMaxInr) {
        throw new BadRequestAppException(
          `COD is not available above ₹${codMaxInr}. Please pay online for this order.`,
        );
      }

      // Per-fulfillment-node COD eligibility. The previous single cart-level
      // codRuleEngine.evaluate() omitted sellerId, so admin SELLER_DENY rules
      // (and seller-active / per-seller serviceability / abuse) were silently
      // bypassed — a seller flagged COD-ineligible still received COD orders in
      // a multi-seller cart. Evaluate each SELLER node through the full facade.
      const codSellerIds = Array.from(
        new Set(
          session.items
            .filter((i) => i.allocatedNodeType !== 'FRANCHISE' && i.allocatedSellerId)
            .map((i) => i.allocatedSellerId as string),
        ),
      );
      for (const sellerId of codSellerIds) {
        const verdict = await this.codFacade.evaluateCodEligibility({
          customerId: userId,
          sellerId,
          orderValue: orderTotalInr,
          pincode,
        });
        if (!verdict.allowed) {
          throw new BadRequestAppException(
            `COD not available for this order: ${verdict.reasons.join('; ')}`,
          );
        }
      }

      // FRANCHISE nodes (and pure-franchise carts) — the facade's seller-row /
      // seller-service-area lookups don't apply to franchises, so run the
      // admin rule engine directly (pincode / value / customer rules; sellerId
      // omitted by design — SELLER_DENY is a seller concept). Also covers the
      // case where there were NO seller nodes so the loop above ran zero times.
      const hasFranchiseNode = session.items.some(
        (i) => i.allocatedNodeType === 'FRANCHISE',
      );
      if (hasFranchiseNode || codSellerIds.length === 0) {
        const verdict = await this.codRuleEngine.evaluate({
          pincode,
          customerId: userId,
          orderTotalInr,
        });
        if (!verdict.eligible) {
          throw new BadRequestAppException(
            `COD not available for this order: ${verdict.reason ?? 'blocked by COD rule'}`,
          );
        }
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
    //
    // Phase 184 (#14) — STACKING ORDER (documented): chargedTotal already =
    // item subtotal − coupon discount + shipping (+ GST is folded into the line
    // totals upstream). Wallet then applies LAST, against that full post-discount,
    // post-shipping, post-tax payable. So: discount → (shipping + tax) → wallet.
    // Razorpay/COD collect only `payableInRupees` = chargedTotal − wallet.
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

    const placeInput: PlaceOrderTransactionInput = {
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
    };

    // Option B (Phase 2) — DEFERRED ONLINE checkout. When the flag is on and
    // this is an online order with a gateway portion to capture, do NOT create
    // the order now: persist a CheckoutSession intent (frozen snapshot + the
    // already-reserved stock held, NOT confirmed) and mint the Razorpay order;
    // the real MasterOrder is materialized only on payment success (Phase 3).
    // COD and wallet-fully-covered (payable <= 0) keep the immediate create-
    // then-pay path; flag off ⇒ entirely unchanged.
    if (
      this.deferredOrderService.enabled() &&
      method === 'ONLINE' &&
      payableInRupees > 0
    ) {
      return await this.createDeferredOnlineCheckout({
        placeInput,
        addressId: session.addressId ?? null,
        sessionCreatedAt: String(session.createdAt),
        reservationLinks: session.items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId ?? null,
          quantity: it.quantity,
          reservationId: it.reservationId ?? null,
          allocatedNodeType: it.allocatedNodeType ?? null,
          allocatedSellerId: it.allocatedSellerId ?? null,
        })),
        walletDebitInPaise,
        payableInRupees,
        discountId,
        allocationEnabled,
        discountReservationId,
      });
    }

    let result;
    try {
      result = await this.repo.placeOrderTransaction(placeInput);
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
          // Do NOT release the discount reservation here. It is keyed on
          // session.createdAt, so this losing concurrent request shares the
          // SAME reservation row as the winner (the order-creating request),
          // which owns its lifecycle (commit on success / release on its own
          // failure). Releasing here races that commit and can flip a valid
          // redemption to RELEASED — coupon usage silently uncounted.
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
      // Compensating action: release reservations on failure.
      // Phase 197 (Checkout audit #12) — release BOTH franchise AND
      // seller reservations explicitly. Pre-Phase-197 only franchise
      // holds were released here; seller StockReservation rows were
      // left to their 15-min TTL, so a failed place-order kept seller
      // stock locked for up to 15 minutes (a customer could see
      // "out of stock" on an item nobody actually bought). We now
      // release the seller reservation immediately via the catalog
      // facade; the TTL sweep stays as the backstop for the rare case
      // where this best-effort release itself fails.
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
        } else if (item.allocatedNodeType !== 'FRANCHISE' && item.reservationId) {
          // Seller path — release the StockReservation row now instead
          // of waiting out the TTL. Guarded on NOT-franchise so a
          // franchise ledger hold (no StockReservation entity) never
          // reaches releaseReservation.
          try {
            await this.catalogFacade.releaseReservation(item.reservationId);
          } catch {
            // Best-effort; ReservationExpirySweepCron is the TTL backstop.
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

    // Idempotency fast-path: the repo found an existing order with this
    // deterministic key (a concurrent double-submit / retry where the original
    // already committed). Its post-tx side effects — stock confirm, wallet
    // debit, Razorpay order, discount commit, finalize, events — ALL ran during
    // the original placement. Re-running them here would double-deduct stock,
    // double-debit the wallet, and mint a second Razorpay order. Short-circuit
    // exactly like the IDEMPOTENCY_CONFLICT path: release THIS request's
    // orphaned discount reservation and return the existing order's summary.
    if (result.reusedExistingOrder) {
      this.logger.warn(
        `Reused existing order ${result.orderNumber} for user ${userId} (idempotent replay); skipping post-tx side effects.`,
      );
      // Do NOT release the discount reservation here. The reservation is keyed
      // on session.createdAt, so this concurrent duplicate shares the SAME
      // reservation row as the order-creating request — which owns its
      // lifecycle (commits it on success, releases it on its own failure).
      // Releasing here would race that commit and flip a valid redemption to
      // RELEASED (lost coupon usage count).
      return {
        orderNumber: result.orderNumber,
        totalAmount: result.totalAmount,
        walletPaidAmount: 0,
        itemCount: result.itemCount,
        paymentMethod: method,
        idempotencyReplay: true,
      };
    }

    // Confirm seller stock + debit the wallet portion (with rollback) — shared
    // with the deferred-order materialization path (Option B Phase 1).
    const { walletTransactionId } = await this.confirmStockAndDebitWallet({
      result,
      reservationLinks: session.items,
      walletDebitInPaise,
      userId,
      discountReservationId,
    });

    // Remove checkout session
    await this.sessionService.delete(userId);

    // Discount allocation + ledger + redemption, then GST tax snapshots —
    // shared with the deferred-order materialization path (Option B Phase 1).
    await this.runOrderDiscountAndTax({
      result,
      discountId,
      allocationEnabled,
      discountReservationId,
      discountCode,
      discountAmount,
    });

    // Publish domain events for order creation (shared with the deferred-order
    // materialization path — Option B Stage 1).
    await this.emitOrderCreatedEvents(result, userId);

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
          walletTransactionId, // Phase 184 (#11)
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
            // PENDING → CREATED: the gateway order intent is minted (modal not
            // yet completed). Lets the expiry sweep / analytics distinguish
            // "Razorpay order created, awaiting customer" from a bare PENDING.
            // verify + webhook both accept CREATED as a pre-paid state.
            paymentStatus: 'CREATED',
            // Stamp the EXACT paise we asked the gateway to capture (payable
            // = total − wallet). Written directly (passes through applyPaise
            // untouched — not a registry field), so verify is correct for
            // wallet-assisted orders AND independent of MONEY_DUAL_WRITE.
            gatewayAmountInPaise: BigInt(Math.round(payableInRupees * 100)),
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
          walletTransactionId, // Phase 184 (#11)
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
        // Phase 197 (Checkout audit #25) — cascade the cancel to the
        // sub-orders. Pre-Phase-197 the master flipped CANCELLED on a
        // Razorpay createOrder failure but the SubOrders stayed
        // PENDING/UNFULFILLED, so the admin queue + settlement sweep
        // still saw "live" sub-orders for a dead order, and the
        // acceptStatus stayed OPEN (a seller could "accept" a cancelled
        // order). Mirror the customer-cancel terminal shape.
        await this.prisma.subOrder.updateMany({
          where: { masterOrderId: result.masterOrderId },
          data: {
            paymentStatus: 'CANCELLED',
            fulfillmentStatus: 'CANCELLED',
            acceptStatus: 'REJECTED',
            // Keep the settlement sweep from picking these up; no
            // commission is due on a payment that never initialised.
            commissionProcessed: true,
            commissionDecision: 'NOT_APPLICABLE' as any,
          },
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
  /**
   * Option B (Phase 2) — persist a DEFERRED online checkout: snapshot the exact
   * order-creation input + the held reservations into a CheckoutSession, mint a
   * Razorpay order against the SESSION (no MasterOrder yet), and return the
   * gateway handoff. Nothing is committed — no order, no wallet debit, no
   * discount redemption; payment success materializes it (Phase 3). Reached only
   * behind CHECKOUT_DEFERRED_ORDER_CREATION for ONLINE orders with payable > 0.
   *
   * Lifecycle of the held resources (Phase-2 review notes):
   *   • The Redis checkout session / cart is INTENTIONALLY left live (not
   *     deleted) — Option B keeps the cart recoverable until payment succeeds;
   *     Phase 3's materialize clears it (placeOrderTransaction deletes the cart)
   *     and deletes the Redis session at that point. An abandoned one lapses on
   *     its own TTL.
   *   • Stock AND discount reservations are HELD (RESERVED, not committed). If
   *     the customer never pays they are released by their existing TTL sweeps
   *     (catalog releaseExpiredReservations + discounts ReleaseExpiredRedemptions
   *     Cron) — so nothing is permanently orphaned. Phase 5 will release them
   *     EXPLICITLY on CheckoutSession expiry (sooner than the per-row TTL);
   *     discountReservationId is snapshotted precisely so Phase 5 can do that.
   *   • walletDebitInPaise is also preserved on the walletApplyInPaise BigInt
   *     column — Phase 3 should read the gateway/wallet paise from the BigInt
   *     columns (pristine), not the snapshot's Number mirror.
   */
  private async createDeferredOnlineCheckout(ctx: {
    placeInput: PlaceOrderTransactionInput;
    addressId: string | null;
    sessionCreatedAt: string;
    reservationLinks: Array<{
      productId: string;
      variantId: string | null;
      quantity: number;
      reservationId: string | null;
      allocatedNodeType: string | null;
      allocatedSellerId: string | null;
    }>;
    walletDebitInPaise: number;
    payableInRupees: number;
    discountId: string | null;
    allocationEnabled: boolean;
    discountReservationId: string | null;
  }) {
    const {
      placeInput,
      addressId,
      sessionCreatedAt,
      reservationLinks,
      walletDebitInPaise,
      payableInRupees,
      discountId,
      allocationEnabled,
      discountReservationId,
    } = ctx;

    const gatewayAmountInPaise = BigInt(Math.round(payableInRupees * 100));

    // 1) Persist the intent (no order, no wallet debit, no discount commit).
    const checkoutSession = await this.deferredOrderService.createSession({
      placeInput,
      walletApplyInPaise: BigInt(walletDebitInPaise),
      gatewayAmountInPaise,
      addressId,
      windowMinutes: PAYMENT_WINDOW_MINUTES,
      reservationLinks,
      discountId,
      allocationEnabled,
      discountReservationId,
    });

    // 2) Mint the Razorpay order against the SESSION. Deterministic idempotency
    //    key (customer + session.createdAt) so a double-submit / retry past the
    //    @Idempotent TTL returns the same gateway order.
    const idempotencyKey = `checkout-session-${createHash('sha256')
      .update(`${placeInput.customerId}|${sessionCreatedAt}`)
      .digest('hex')
      .slice(0, 40)}`;
    const razorpayOrder = await this.razorpayAdapter.createOrder({
      amountInPaise: gatewayAmountInPaise,
      receipt: checkoutSession.id,
      notes: {
        checkoutSessionId: checkoutSession.id,
        customerId: placeInput.customerId,
      },
      idempotencyKey,
    });
    await this.deferredOrderService.attachRazorpayOrder(
      checkoutSession.id,
      razorpayOrder.providerOrderId,
    );

    // 3) Return the gateway handoff. NOTE: no orderNumber yet — the order is
    //    created on payment success (Phase 3); the frontend keys off
    //    checkoutSessionId and waits for the order to appear (Phase 6).
    return {
      checkoutSessionId: checkoutSession.id,
      paymentMethod: 'ONLINE' as const,
      deferred: true as const,
      payment: {
        razorpayOrderId: razorpayOrder.providerOrderId,
        razorpayKeyId: this.razorpayClient.getKeyId(),
        amount: Number(razorpayOrder.amountInPaise) / 100,
        currency: razorpayOrder.currency,
        expiresAt: checkoutSession.expiresAt.toISOString(),
      },
    };
  }

  /**
   * Confirm seller stock reservations (deduct stockQty + link reservation→
   * OrderItem) then debit the wallet portion — with full partial-failure
   * rollback (cancel the order + restore confirmed stock + release franchise
   * holds + the discount reservation). Throws BadRequestAppException on failure.
   *
   * Option B (Phase 1) — extracted from placeOrderLocked over a reservation-link
   * list so the deferred-order materialization path runs the IDENTICAL sequence
   * from a CheckoutSession snapshot (A passes the live Redis `session.items`; B
   * passes links rebuilt from the snapshot), with no duplicated copy to drift.
   */
  private async confirmStockAndDebitWallet(ctx: {
    result: PlaceOrderTransactionResult;
    reservationLinks: Array<{
      productId: string;
      variantId: string | null;
      quantity: number;
      reservationId?: string | null;
      allocatedNodeType?: 'SELLER' | 'FRANCHISE' | string | null;
      allocatedSellerId?: string | null;
    }>;
    walletDebitInPaise: number;
    userId: string;
    discountReservationId: string | null;
  }): Promise<{ walletTransactionId: string | null }> {
    const {
      result,
      reservationLinks,
      walletDebitInPaise,
      userId,
      discountReservationId,
    } = ctx;

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
    // Map: index in reservationLinks → orderItemId. We need to know the
    // OrderItem id per reservation link so the FK linkage can be written.
    // Build it by re-reading the order items in (subOrder, line-order).
    const orderItemsForLinkage = await this.prisma.orderItem.findMany({
      where: { subOrder: { masterOrderId: result.masterOrderId } },
      select: { id: true, productId: true, variantId: true, quantity: true, subOrderId: true },
    });
    for (let i = 0; i < reservationLinks.length; i++) {
      const item = reservationLinks[i];
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
          `Stock confirmation failed for reservation ${item.reservationId} on order ${result.masterOrderId} (item ${i + 1}/${reservationLinks.length}): ${(err as Error).message}`,
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
      // Release the FRANCHISE holds placed at initiate. These are ledger
      // reservations (no StockReservation entity), so they're untouched by the
      // seller restoreForReservation loop above — without this they'd sit
      // locked until the 15-min cleanup cron, stranding franchise stock for an
      // order that's now CANCELLED. Mirrors the placeOrderTransaction-failure
      // compensation path. Best-effort; FranchiseReservationCleanupService is
      // the TTL backstop.
      for (const item of reservationLinks) {
        if (item.allocatedNodeType === 'FRANCHISE' && item.allocatedSellerId) {
          try {
            await this.franchiseFacade.unreserveStock(
              item.allocatedSellerId,
              item.productId,
              item.variantId,
              item.quantity,
              item.reservationId ?? undefined,
            );
          } catch {
            /* best-effort — cleanup cron releases stragglers */
          }
        }
      }
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
    let walletTransactionId: string | null = null;
    if (walletDebitInPaise > 0) {
      try {
        const debitResult = await this.walletFacade.debitForCheckout({
          userId,
          amountInPaise: walletDebitInPaise,
          orderId: result.masterOrderId,
          orderNumber: result.orderNumber,
          description: `Order ${result.orderNumber} — wallet portion`,
        });
        walletTransactionId = debitResult.transaction.id;
        // Phase 184 (#2/#3) — snapshot the authoritative wallet portion + the
        // linked ledger row on the order. Non-fatal if it fails (the refund
        // calculator falls back to the ledger query); log loudly.
        await this.prisma.masterOrder
          .update({
            where: { id: result.masterOrderId },
            data: {
              walletAmountUsedInPaise: BigInt(walletDebitInPaise),
              walletTransactionId,
            },
          })
          .catch((snapErr) =>
            this.logger.warn(
              `Wallet-usage snapshot failed for order ${result.masterOrderId}: ${(snapErr as Error).message}`,
            ),
          );
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
          for (const item of reservationLinks) {
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
        for (const item of reservationLinks) {
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

    return { walletTransactionId };
  }

  /**
   * Per-item discount allocation + liability ledger + redemption commit (or the
   * legacy usedCount bump), then GST tax snapshots. Both steps are best-effort:
   * the order is already committed and the customer charged correctly, so a
   * failure logs / emits for a recovery cron rather than unwinding the order.
   *
   * Option B (Phase 1) — extracted from placeOrderLocked so the deferred-order
   * materialization path runs the IDENTICAL sequence from a CheckoutSession
   * snapshot, with no duplicated copy to drift. Session-free by construction
   * (keys only on the order result + discount inputs).
   */
  private async runOrderDiscountAndTax(ctx: {
    result: PlaceOrderTransactionResult;
    discountId: string | null;
    allocationEnabled: boolean;
    discountReservationId: string | null;
    discountCode: string | null;
    discountAmount: number;
  }): Promise<void> {
    const {
      result,
      discountId,
      allocationEnabled,
      discountReservationId,
      discountCode,
      discountAmount,
    } = ctx;

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
          // Phase 247-FB — ALSO read the discount's ACTUAL funding config.
          // Previously this hardcoded `{ fundingType: 'PLATFORM' }`, so a
          // SELLER/BRAND/SHARED/FRANCHISE-funded campaign was silently
          // booked as PLATFORM at allocation — the funding the admin set
          // never reached the liability ledger (a real cost-attribution
          // leak). We now thread the real split + franchise/brand ids.
          ...(await (async () => {
            const d = await this.prisma.discount.findUnique({
              where: { id: discountId },
              select: {
                affiliateId: true,
                fundingType: true,
                platformFundingPercent: true,
                sellerFundingPercent: true,
                brandFundingPercent: true,
                franchiseFundingPercent: true,
                franchiseId: true,
                brandId: true,
              },
            });
            return {
              source: d?.affiliateId
                ? ('AFFILIATE' as const)
                : ('CODE' as const),
              funding: {
                fundingType: (d?.fundingType as any) ?? 'PLATFORM',
                platformFundingPercent: Number(d?.platformFundingPercent ?? 100),
                sellerFundingPercent: Number(d?.sellerFundingPercent ?? 0),
                brandFundingPercent: Number(d?.brandFundingPercent ?? 0),
                franchiseFundingPercent: Number(
                  d?.franchiseFundingPercent ?? 0,
                ),
                franchiseId: d?.franchiseId ?? null,
                brandId: d?.brandId ?? null,
              },
            };
          })()),
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
  }

  /**
   * Emit the order-creation domain events (orders.master.created + one
   * orders.sub_order.created per sub-order). Best-effort — a publish failure
   * must never fail an already-committed order.
   *
   * Option B (Stage 1) — extracted from placeOrderLocked so the deferred-order
   * materialization path emits the IDENTICAL events from a CheckoutSession
   * snapshot, with no duplicated copy to drift. Session-free by construction
   * (keys only on the placeOrderTransaction result + customer id).
   */
  private async emitOrderCreatedEvents(
    result: PlaceOrderTransactionResult,
    userId: string,
  ): Promise<void> {
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
  }

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
    // Option B (Phase 3) — deferred path. When the flag is on and this Razorpay
    // order belongs to a CheckoutSession (no MasterOrder was created at
    // checkout), validate the payment and MATERIALIZE the order from the
    // session. Falls through to the legacy MasterOrder path otherwise.
    if (this.deferredOrderService.enabled()) {
      const deferredSession =
        await this.deferredOrderService.findByRazorpayOrderId(
          input.razorpayOrderId,
          userId,
        );
      if (deferredSession) {
        return await this.verifyAndMaterializeDeferred(
          userId,
          input,
          deferredSession,
        );
      }
    }

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
          amountInPaise: BigInt(order.totalAmountInPaise),
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
        // Money-safety alert: a write failure must NOT be silent — log LOUDLY
        // so a degraded alert store is visible to ops (the throw below is the
        // load-bearing guard; this just preserves observability).
        .catch((alertErr) =>
          this.logger.error(
            `Failed to record SIGNATURE_INVALID alert for ${order.orderNumber}: ${(alertErr as Error)?.message ?? alertErr}`,
          ),
        );
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
          amountInPaise: BigInt(order.totalAmountInPaise),
          failureReason: `fetchPayment failed: ${err?.message ?? 'unknown'}`,
        })
        .catch(() => undefined);
      throw new BadRequestAppException(
        'Payment verification failed — could not confirm with gateway. Please retry shortly.',
      );
    }

    try {
      assertGatewayPaymentMatchesOrder(gatewayPayment, {
        // The gateway was charged the PAYABLE (total − wallet), not the full
        // order total. Comparing against totalAmountInPaise rejected every
        // wallet-assisted online payment. resolveExpectedGatewayPaise reads
        // the authoritative gatewayAmountInPaise (or the net fallback).
        expectedAmountInPaise: resolveExpectedGatewayPaise(order),
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
          // Phase 165 (#12) — pass BigInt paise directly; the facade accepts
          // number | bigint | string, so we avoid the lossy Number() coercion
          // that truncated amounts above ~₹90L.
          // Report the GATEWAY-expected amount (payable), not the full order
          // total, so finance sees the real comparison baseline.
          expectedInPaise: resolveExpectedGatewayPaise(order),
          actualInPaise: gatewayPayment.amount,
          severity: 95,
          description:
            `Gateway verification rejected for order ${order.orderNumber}: ${err.message} ` +
            `(razorpay_order ${input.razorpayOrderId}, payment ${input.razorpayPaymentId}).`,
        })
        // Money-safety alert (AMOUNT_MISMATCH/SIGNATURE) — log on write failure
        // instead of swallowing, so finance loses no visibility on anomalies.
        .catch((alertErr) =>
          this.logger.error(
            `Failed to record gateway-mismatch alert for ${order.orderNumber}: ${(alertErr as Error)?.message ?? alertErr}`,
          ),
        );
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

    // Phase 165 (#4/#18) — CAS flip. The findFirst + assertTransition above
    // is a read-time check; a concurrent verify (e.g. the orphan-recovery
    // event handler firing the same payment) or an admin cancellation can
    // land between the read and this write. Guard the flip on the still-PENDING
    // state so EXACTLY ONE caller flips PLACED+PAID; the loser is a no-op.
    const flip = await this.prisma.masterOrder.updateMany({
      where: {
        id: order.id,
        orderStatus: 'PENDING_PAYMENT',
        // Cast mirrors OrdersPublicFacade.flipPaymentStatusIfFrom — the
        // OrderPaymentStatus enum is the canonical type; the string union
        // is widened at the Prisma boundary.
        // Phase 257 — 'FAILED' is NOT a member of OrderPaymentStatus
        // (CREATED|PENDING|PAID|EXPIRED|VOIDED|CANCELLED); passing it in the
        // `in` array made Prisma reject the whole query ("Invalid value for
        // argument `in`. Expected OrderPaymentStatus"), 500-ing every online
        // payment verify. The valid pre-paid states are PENDING + CREATED
        // (Phase-66 "Razorpay order minted, modal unopened").
        paymentStatus: { in: ['PENDING', 'CREATED'] as any },
      },
      data: this.moneyDualWrite.applyPaise('masterOrder', {
        orderStatus: 'PLACED',
        paymentStatus: 'PAID',
        razorpayPaymentId: input.razorpayPaymentId,
        verificationDeadlineAt,
      }),
    });
    if (flip.count === 0) {
      // Lost the race or the order moved out of PENDING_PAYMENT. If it's
      // already PAID (concurrent verify / webhook won), this verify is
      // idempotent — return success. Otherwise it was cancelled/rejected
      // between read and write — refuse to resurrect it.
      const fresh = await this.prisma.masterOrder.findUnique({
        where: { id: order.id },
        select: { paymentStatus: true, razorpayPaymentId: true },
      });
      if (fresh?.paymentStatus === 'PAID') {
        return {
          verified: true,
          orderNumber: order.orderNumber,
          totalAmount: Number(order.totalAmount),
          paymentId: fresh.razorpayPaymentId ?? input.razorpayPaymentId,
        };
      }
      throw new BadRequestAppException(
        'Order can no longer be marked paid (it may have been cancelled). ' +
          'If you were charged, the orphan-recovery process will reconcile it.',
      );
    }

    await this.prisma.subOrder.updateMany({
      where: { masterOrderId: order.id },
      data: { paymentStatus: 'PAID' },
    });

    // Phase 70 — Payment shadow row flips to CAPTURED.
    await this.paymentLifecycle.markCaptured({
      providerOrderId: input.razorpayOrderId,
      providerPaymentId: input.razorpayPaymentId,
    });

    // Payment-ops: SUCCESS verify-signature attempt. Phase 165 (#12) —
    // pass BigInt paise directly (no lossy Number coercion).
    this.paymentOpsFacade
      .recordAttempt({
        masterOrderId: order.id,
        orderNumber: order.orderNumber,
        kind: 'VERIFY_SIGNATURE',
        status: 'SUCCESS',
        providerOrderId: input.razorpayOrderId,
        providerPaymentId: input.razorpayPaymentId,
        // The captured (gateway) amount = payable, not the full order total.
        amountInPaise: resolveExpectedGatewayPaise(order),
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
      // The order is already durably PAID at this point. If this publish fails
      // (or the process dies before it), downstream effects (commission lock,
      // confirmation email, loyalty) are missed and the poller won't re-find
      // the order (razorpayPaymentId is set). Log LOUDLY so ops can replay.
      // The durable exactly-once fix is the transactional outbox (OUTBOX_ENABLED)
      // — emit the event in the same tx as the CAS flip; tracked separately.
      .catch((pubErr) =>
        this.logger.error(
          `payments.payment.captured publish FAILED for PAID order ${order.orderNumber}: ${(pubErr as Error)?.message ?? pubErr} — downstream side-effects may be missed`,
        ),
      );

    // Phase 165 (#15) — compliance audit on a successful payment verification
    // (PaymentAttempt is observability; this is the actor-attributed ledger).
    this.auditFacade
      .writeAuditLog({
        actorId: userId,
        actorRole: 'CUSTOMER',
        action: 'payments.verify.succeeded',
        module: 'payments',
        resource: 'master_order',
        resourceId: order.id,
        metadata: {
          orderNumber: order.orderNumber,
          razorpayOrderId: input.razorpayOrderId,
          razorpayPaymentId: input.razorpayPaymentId,
          amountInPaise: order.totalAmountInPaise.toString(),
        },
      })
      .catch(() => undefined);

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
  /**
   * Option B (Phase 4) — ASYNC materialize entry for the GATEWAY-TRUSTED paths
   * (the Razorpay webhook + the deferred-capture recovery cron). Unlike the sync
   * customer verify there is no HMAC signature to check (that only exists on the
   * browser redirect); trust comes from the webhook's own signature check / the
   * cron's direct gateway poll, PLUS a re-fetch here that asserts the captured
   * amount equals the session's gateway amount. Looks the session up by
   * razorpayOrderId (gateway-trusted; no customer scope). Returns the order on
   * success, or null when no session owns this order id, the session is already
   * terminal, the gateway amount can't be confirmed, or a concurrent caller is
   * still materializing. NEVER throws — async callers log + rely on the backstop
   * cron; materialize() itself marks the session FAILED on refundable errors.
   */
  async materializeFromGateway(
    razorpayOrderId: string,
    razorpayPaymentId: string,
  ): Promise<{ masterOrderId: string; orderNumber: string } | null> {
    const session =
      await this.deferredOrderService.findByRazorpayOrderId(razorpayOrderId);
    if (!session) {
      // No deferred session owns this gateway order — a genuine legacy orphan
      // (the legacy webhook/poller path handles those). Nothing to do here.
      return null;
    }

    // Already materialized — idempotent success.
    if (session.status === 'ORDER_CREATED' && session.masterOrderId) {
      const existing = await this.prisma.masterOrder.findUnique({
        where: { id: session.masterOrderId },
        select: { id: true, orderNumber: true },
      });
      if (existing) {
        return { masterOrderId: existing.id, orderNumber: existing.orderNumber };
      }
    }

    // Terminal non-creatable states — a captured payment against an expired or
    // already-failed session is a Phase-5 refund concern, not a materialize.
    // A capture on an EXPIRED session that never claimed (no razorpayPaymentId)
    // is a late capture (delayed webhook / async settle) whose money would
    // otherwise be stranded — stamp it FAILED + the payment id so the Phase-5
    // refund sweep refunds it. FAILED sessions already carry the payment id and
    // are already in the refund queue.
    if (session.status === 'EXPIRED' || session.status === 'FAILED') {
      if (!session.razorpayPaymentId) {
        await this.deferredOrderService.markFailedAwaitingRefund(
          session.id,
          razorpayPaymentId,
          `late capture on ${session.status} session`,
        );
        this.logger.warn(
          `materializeFromGateway: late capture on ${session.status} session ` +
            `${session.id} → FAILED for refund (payment ${razorpayPaymentId}).`,
        );
      } else {
        this.logger.warn(
          `materializeFromGateway: session ${session.id} is ${session.status} ` +
            `(already tracks payment ${session.razorpayPaymentId}); skipping.`,
        );
      }
      return null;
    }

    // Gateway-truth amount check — re-fetch + assert the captured amount equals
    // the session's gateway amount (a ₹1 payment must not unlock a ₹10k order).
    // A fetch failure is transient (the cron retries); a captured-but-wrong-
    // amount is a MONEY ANOMALY → open a finance alert (parity with the legacy
    // verify/orphan paths) so it's visible on the payment-ops dashboard. Either
    // way we do NOT materialize; the session stays CREATED → expires → Phase-5
    // refunds the captured payment (the safe outcome for a bad amount).
    let gatewayPayment: Awaited<ReturnType<RazorpayAdapter['getRawPayment']>>;
    try {
      gatewayPayment =
        await this.razorpayAdapter.getRawPayment(razorpayPaymentId);
    } catch (err) {
      this.logger.error(
        `materializeFromGateway: gateway fetch failed for session ` +
          `${session.id} (payment ${razorpayPaymentId}): ${(err as Error).message}`,
      );
      return null;
    }
    try {
      assertGatewayPaymentMatchesOrder(gatewayPayment, {
        expectedAmountInPaise: BigInt(session.gatewayAmountInPaise),
        razorpayOrderId,
      });
    } catch (err: any) {
      if (err?.code === 'GATEWAY_AMOUNT_MISMATCH') {
        // Captured amount ≠ what we asked the gateway to charge — finance must
        // see this (the legacy sync verify + orphan poller both alert here).
        this.paymentOpsFacade
          .flagMismatch({
            kind: 'AMOUNT_MISMATCH',
            masterOrderId: null,
            orderNumber: null,
            providerPaymentId: razorpayPaymentId,
            expectedInPaise: BigInt(session.gatewayAmountInPaise),
            actualInPaise: gatewayPayment.amount,
            severity: 95,
            description:
              `Deferred-checkout amount mismatch for session ${session.id}: ${err.message} ` +
              `(razorpay_order ${razorpayOrderId}, payment ${razorpayPaymentId}). ` +
              `Order NOT materialized; session left for Phase-5 refund.`,
          })
          .catch((alertErr) =>
            this.logger.error(
              `materializeFromGateway: failed to record mismatch alert for ` +
                `session ${session.id}: ${(alertErr as Error)?.message ?? alertErr}`,
            ),
          );
      }
      this.logger.error(
        `materializeFromGateway: gateway validation failed for session ` +
          `${session.id} (payment ${razorpayPaymentId}): ${err?.message ?? err}`,
      );
      return null;
    }

    try {
      return await this.materializeOrderFromSession(session, {
        razorpayPaymentId,
      });
    } catch (err) {
      // materialize already marked the session FAILED (Phase-5 auto-refund).
      this.logger.error(
        `materializeFromGateway: materialize threw for session ${session.id} ` +
          `(payment ${razorpayPaymentId}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Option B (Phase 3) — verify a captured payment for a DEFERRED checkout and
   * materialize the order from its CheckoutSession. Mirrors the legacy verify's
   * security checks (HMAC signature + gateway-amount re-fetch) but against the
   * session's gatewayAmountInPaise (no MasterOrder exists yet).
   *
   * NOTE: the HMAC + gateway-amount validation is intentionally DUPLICATED from
   * the legacy MasterOrder verify path to keep that hardened path untouched —
   * KEEP THE TWO IN SYNC (deduping into a shared validator is a tracked cleanup).
   */
  private async verifyAndMaterializeDeferred(
    userId: string,
    input: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
    session: DeferredCheckoutSession,
  ) {
    // Already materialized — idempotent success.
    if (session.status === 'ORDER_CREATED' && session.masterOrderId) {
      const existing = await this.prisma.masterOrder.findUnique({
        where: { id: session.masterOrderId },
        select: { orderNumber: true, totalAmount: true },
      });
      if (existing) {
        return {
          verified: true,
          orderNumber: existing.orderNumber,
          totalAmount: Number(existing.totalAmount),
          paymentId: input.razorpayPaymentId,
        };
      }
    }

    if (session.expiresAt && new Date() > session.expiresAt) {
      throw new BadRequestAppException(
        'Payment window has expired. Please place a new order.',
      );
    }

    // HMAC signature — fail-closed, constant-time (mirrors the legacy verify).
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
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const actualBuf = Buffer.from(input.razorpaySignature, 'utf8');
    const isValidSignature =
      expectedBuf.length === actualBuf.length &&
      crypto.timingSafeEqual(expectedBuf, actualBuf);
    if (!isValidSignature) {
      this.logger.error(
        `Deferred verify: invalid signature for session ${session.id} ` +
          `(razorpay_order ${input.razorpayOrderId}, payment ${input.razorpayPaymentId})`,
      );
      throw new BadRequestAppException(
        'Payment verification failed — invalid signature',
      );
    }

    // Gateway-truth amount check — the HMAC only proves the (order,payment) pair
    // is from Razorpay; re-fetch + assert the captured amount equals the
    // session's gateway amount so a ₹1 payment can't unlock a ₹10k order.
    let gatewayPayment: Awaited<ReturnType<RazorpayAdapter['getRawPayment']>>;
    try {
      gatewayPayment = await this.razorpayAdapter.getRawPayment(
        input.razorpayPaymentId,
      );
    } catch (err: any) {
      this.logger.error(
        `Deferred verify: gateway fetchPayment failed for ${input.razorpayPaymentId}: ${err?.message ?? err}`,
      );
      throw new BadRequestAppException(
        'Payment verification failed — could not confirm with gateway. Please retry shortly.',
      );
    }
    assertGatewayPaymentMatchesOrder(gatewayPayment, {
      expectedAmountInPaise: BigInt(session.gatewayAmountInPaise),
      razorpayOrderId: input.razorpayOrderId,
    });

    // Validated — materialize (exactly-once via the session CAS).
    let res: { masterOrderId: string; orderNumber: string } | null;
    try {
      res = await this.materializeOrderFromSession(session, {
        razorpayPaymentId: input.razorpayPaymentId,
      });
    } catch (err) {
      // materialize already marked the session FAILED (Phase-5 auto-refund).
      this.logger.error(
        `Deferred verify: materialize threw for session ${session.id}: ${(err as Error).message}`,
      );
      throw new BadRequestAppException(
        'Your payment succeeded but the order could not be created. A refund will be issued automatically.',
      );
    }
    if (!res) {
      // A concurrent caller (webhook/poller) claimed it and is still creating
      // the order — tell the client to poll (Phase 6 wires the wait-for-order).
      throw new ConflictAppException(
        'Payment received — your order is being created. Please refresh in a moment.',
      );
    }
    return {
      verified: true,
      orderNumber: res.orderNumber,
      totalAmount: Number(session.totalAmountInPaise) / 100,
      paymentId: input.razorpayPaymentId,
    };
  }

  /**
   * Option B (Phase 3) — MATERIALIZE the real order from a captured
   * CheckoutSession. The exactly-once guard is claimForMaterialization (atomic
   * CREATED→PAID); only the winner runs the (non-idempotent) order side-effects.
   * Reuses the SAME shared methods the legacy place-order path uses, then flips
   * the just-created order to PLACED/PAID (payment already captured). On any
   * failure the session is marked FAILED (Phase-5 auto-refund) and the error is
   * re-thrown. Returns null when a concurrent caller is still materializing.
   */
  private async materializeOrderFromSession(
    session: DeferredCheckoutSession,
    args: { razorpayPaymentId: string },
  ): Promise<{ masterOrderId: string; orderNumber: string } | null> {
    const { razorpayPaymentId } = args;

    // Fast-path: already materialized.
    if (session.status === 'ORDER_CREATED' && session.masterOrderId) {
      const existing = await this.prisma.masterOrder.findUnique({
        where: { id: session.masterOrderId },
        select: { id: true, orderNumber: true },
      });
      if (existing) {
        return { masterOrderId: existing.id, orderNumber: existing.orderNumber };
      }
    }

    // Exactly-once CAS claim (CREATED→PAID). Losers must NOT run side-effects.
    const { claimed } = await this.deferredOrderService.claimForMaterialization(
      session.id,
      razorpayPaymentId,
    );
    if (!claimed) {
      const fresh = session.razorpayOrderId
        ? await this.deferredOrderService.findByRazorpayOrderId(
            session.razorpayOrderId,
          )
        : null;
      if (fresh?.status === 'ORDER_CREATED' && fresh.masterOrderId) {
        const existing = await this.prisma.masterOrder.findUnique({
          where: { id: fresh.masterOrderId },
          select: { id: true, orderNumber: true },
        });
        if (existing) {
          return {
            masterOrderId: existing.id,
            orderNumber: existing.orderNumber,
          };
        }
      }
      // Claimed by a concurrent caller still creating the order (PAID, no
      // masterOrderId yet) — or it crashed mid-materialize (Phase-5 reconciler
      // finishes/refunds). Signal "in progress" to the caller.
      return null;
    }

    // Winner — materialize from the frozen snapshot.
    const snap = this.deferredOrderService.decodeSnapshot(session);

    // ── REFUNDABLE PHASE. Everything up to and including the PLACED/PAID flip
    //    is the "is this a valid paid order?" question. A throw here means the
    //    order is NOT valid (stock gone, price drift, wallet race, or an admin
    //    cancel landing in the create→flip window) → mark the session FAILED so
    //    the Phase-5 reconciler auto-refunds the captured payment.
    let result: Awaited<
      ReturnType<ICheckoutRepository['placeOrderTransaction']>
    >;
    try {
      result = await this.repo.placeOrderTransaction(snap.placeInput);

      await this.confirmStockAndDebitWallet({
        result,
        reservationLinks: snap.reservationLinks,
        walletDebitInPaise: snap.walletDebitInPaise,
        userId: session.customerId,
        discountReservationId: snap.discountReservationId,
      });
      await this.runOrderDiscountAndTax({
        result,
        discountId: snap.discountId,
        allocationEnabled: snap.allocationEnabled,
        discountReservationId: snap.discountReservationId,
        discountCode: snap.placeInput.discountCode ?? null,
        discountAmount: snap.placeInput.discountAmount ?? 0,
      });

      // ── THE COMMIT POINT. Flip the just-created order PENDING_PAYMENT→
      //    PLACED/PAID (payment already captured) + stamp the gateway linkage.
      //    CAS-guarded on the still-pending state, exactly like the legacy
      //    verify flip: an admin cancel (rejectOrder) can land in the
      //    create→flip window, and the guard refuses to resurrect a cancelled
      //    order (count===0 → throw → refund).
      const verificationSlaMinutes = Math.max(
        1,
        Number(process.env.VERIFICATION_SLA_MINUTES ?? 60),
      );
      const verificationDeadlineAt = new Date(
        Date.now() + verificationSlaMinutes * 60 * 1000,
      );
      const flip = await this.prisma.masterOrder.updateMany({
        where: {
          id: result.masterOrderId,
          orderStatus: 'PENDING_PAYMENT',
          paymentStatus: { in: ['PENDING', 'CREATED'] as any },
        },
        data: this.moneyDualWrite.applyPaise('masterOrder', {
          orderStatus: 'PLACED',
          paymentStatus: 'PAID',
          razorpayOrderId: session.razorpayOrderId,
          razorpayPaymentId,
          gatewayAmountInPaise: BigInt(session.gatewayAmountInPaise),
          verificationDeadlineAt,
        }),
      });
      if (flip.count === 0) {
        // The order we just created is no longer PENDING_PAYMENT. Only an admin
        // cancel can do that to a brand-new order id; if it is somehow already
        // PLACED/PAID treat as idempotently committed, otherwise refuse to
        // resurrect it and refund.
        const fresh = await this.prisma.masterOrder.findUnique({
          where: { id: result.masterOrderId },
          select: { orderStatus: true, paymentStatus: true },
        });
        if (
          !(fresh?.orderStatus === 'PLACED' && fresh?.paymentStatus === 'PAID')
        ) {
          throw new Error(
            `Order ${result.orderNumber} left PENDING_PAYMENT before the ` +
              `payment flip (now ${fresh?.orderStatus}/${fresh?.paymentStatus}) — refusing to resurrect.`,
          );
        }
      }
    } catch (err) {
      // The shared methods' own rollback already cancelled the order + restored
      // stock where applicable; mark the session FAILED for the Phase-5
      // reconciler to auto-refund the captured payment.
      await this.deferredOrderService.markFailed(
        session.id,
        (err as Error).message,
      );
      this.logger.error(
        `Materialize FAILED for session ${session.id} (payment ${razorpayPaymentId}): ${(err as Error).message} — flagged for refund.`,
      );
      throw err;
    }

    // ── COMMITTED. The order EXISTS and is PLACED/PAID — the customer has a
    //    valid paid order. Everything below is propagation/linkage and must
    //    NEVER mark the session FAILED (that would refund a real paid order) nor
    //    throw out of materialize (verify maps a throw to "order could not be
    //    created"). Each step is best-effort + logged; a re-verify or the
    //    Phase-5 reconciler finishes any straggler. markOrderCreated runs first
    //    so the session→order link is set as early as possible.
    try {
      await this.deferredOrderService.markOrderCreated(
        session.id,
        result.masterOrderId,
      );
    } catch (linkErr) {
      this.logger.error(
        `markOrderCreated failed for session ${session.id} → order ` +
          `${result.orderNumber} (order IS paid; reconciler will link): ${(linkErr as Error).message}`,
      );
    }

    await this.prisma.subOrder
      .updateMany({
        where: { masterOrderId: result.masterOrderId },
        data: { paymentStatus: 'PAID' },
      })
      .catch((e) =>
        this.logger.error(
          `subOrder PAID flip failed for ${result.orderNumber}: ${(e as Error).message}`,
        ),
      );

    try {
      await this.emitOrderCreatedEvents(result, session.customerId);
    } catch (evErr) {
      this.logger.error(
        `emitOrderCreatedEvents failed for materialized order ${result.orderNumber}: ${(evErr as Error).message}`,
      );
    }

    // Payment shadow rows — payment-ops parity with the legacy path.
    if (session.razorpayOrderId) {
      try {
        await this.paymentLifecycle.recordOnlinePaymentCreated({
          masterOrderId: result.masterOrderId,
          amountInPaise: BigInt(session.gatewayAmountInPaise),
          providerOrderId: session.razorpayOrderId,
          idempotencyKey: `materialize-${session.id}`,
          expiresAt: session.expiresAt,
        });
        await this.paymentLifecycle.markCaptured({
          providerOrderId: session.razorpayOrderId,
          providerPaymentId: razorpayPaymentId,
        });
      } catch (payErr) {
        this.logger.error(
          `payment shadow-row update failed for materialized order ${result.orderNumber}: ${(payErr as Error).message}`,
        );
      }
    }

    // Drive downstream (commission lock, confirmation email, loyalty).
    this.eventBus
      .publish({
        eventName: 'payments.payment.captured',
        aggregate: 'MasterOrder',
        aggregateId: result.masterOrderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: result.masterOrderId,
          orderNumber: result.orderNumber,
          customerId: session.customerId,
          paymentId: razorpayPaymentId,
          amount: result.totalAmount,
        },
      })
      .catch((pubErr) =>
        this.logger.error(
          `captured-event publish failed for materialized order ${result.orderNumber}: ${(pubErr as Error).message}`,
        ),
      );

    this.logger.log(
      `Materialized order ${result.orderNumber} from checkout session ${session.id} (payment ${razorpayPaymentId}).`,
    );
    return {
      masterOrderId: result.masterOrderId,
      orderNumber: result.orderNumber,
    };
  }

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

    // Phase 165 (#1) — deterministic idempotency key. retryPayment previously
    // passed NO key, so a double-click (or a network blip + retry) minted two
    // Razorpay orders for the same MasterOrder. Keyed on the order + the retry
    // index (count of prior ONLINE Payment rows): rapid double-clicks compute
    // the SAME index → same key → Razorpay dedupes and returns the same order;
    // a genuine later retry gets a fresh index → a new order.
    const retryIndex = await this.prisma.payment.count({
      where: { masterOrderId: order.id, method: 'ONLINE' },
    });
    const idempotencyKey = `checkout-order-${order.id}-retry-${retryIndex}`;

    // Charge the PAYABLE (total − wallet), NOT the full total. The wallet
    // portion was already debited at place-order; re-charging the full amount
    // on retry would over-collect and then fail verification.
    // resolveExpectedGatewayPaise returns the original gatewayAmountInPaise
    // (or the net fallback for rows predating that column).
    const gatewayChargeInPaise = resolveExpectedGatewayPaise(order);

    // Create a new Razorpay order (previous one may have expired on Razorpay side).
    const razorpayOrder = await this.razorpayAdapter.createOrder({
      amountInPaise: gatewayChargeInPaise,
      receipt: order.orderNumber,
      notes: {
        masterOrderId: order.id,
        orderNumber: order.orderNumber,
        retry: 'true',
      },
      idempotencyKey,
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
        // Keep the authoritative gateway charge in sync with the new order.
        gatewayAmountInPaise: gatewayChargeInPaise,
      }),
    });

    // Phase 165 (#2) — preserve the retry trail in the Payment table. The
    // MasterOrder.razorpayOrderId column is overwritten (one slot), but a new
    // Payment row records EACH gateway order id; orphan recovery scans all of
    // them, so a payment captured against a PRIOR order id is still recovered
    // (previously invisible — a real money-loss blind spot).
    await this.paymentLifecycle.recordOnlinePaymentCreated({
      masterOrderId: order.id,
      // Payment.amountInPaise is the amount sent to the gateway (payable),
      // so orphan-recovery can match it against the captured amount.
      amountInPaise: gatewayChargeInPaise,
      providerOrderId: razorpayOrder.providerOrderId,
      idempotencyKey,
      expiresAt: newExpiry,
    });
    this.paymentOpsFacade
      .recordAttempt({
        masterOrderId: order.id,
        orderNumber: order.orderNumber,
        kind: 'CREATE_ORDER',
        status: 'SUCCESS',
        providerOrderId: razorpayOrder.providerOrderId,
        amountInPaise: gatewayChargeInPaise,
      })
      .catch(() => undefined);

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
