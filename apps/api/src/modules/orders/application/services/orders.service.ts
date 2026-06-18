import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../../../core/exceptions';
import { Prisma } from '@prisma/client';
import {
  CatalogPublicFacade,
} from '../../../catalog/application/facades/catalog-public.facade';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';
import { TaxPublicFacade } from '../../../tax/application/facades/tax-public.facade';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  OrderRepository,
  ORDER_REPOSITORY,
} from '../../domain/repositories/order.repository.interface';
import { assertTransition, isTransitionAllowed } from '../../../../core/fsm/status-transitions';
import { StockRestoreService } from './stock-restore.service';
// Phase 68 (2026-05-22) — audit log on single-order verify (Gap #11).
// Optional dependency: the AuditModule is wired in orders/module.ts.
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { Optional } from '@nestjs/common';
// Phase 74 (2026-05-22) — Phase 73 audit Gap #1. Refund saga for
// prepaid orders rejected at verification. Global module, so no
// imports change needed.
import { RefundInstructionService } from '../../../refund-instructions/application/services/refund-instruction.service';
// Phase 84 (2026-05-23) — order timeline / status history recorder.
import { OrderTimelineService } from './order-timeline.service';
// Phase 88 (2026-05-23) — typed shipment-evidence orchestrator.
import { ShipmentEvidenceService } from '../../../shipping/application/services/shipment-evidence.service';
// Phase 89 (2026-05-23) — EWB ship-block gate at the SHIPPED transition.
import { EWayBillService } from '../../../tax/application/services/eway-bill.service';
// Phase 168 (COD Mark-Paid audit #15) — open a PaymentMismatchAlert when a COD
// mark-paid flips paymentStatus but the orderStatus FSM can't reach DELIVERED,
// instead of swallowing the inconsistency in a log line. PaymentOpsModule is
// @Global so no OrdersModule.imports change is needed.
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';

export type ReassignTarget =
  | { nodeType: 'SELLER'; nodeId: string }
  | { nodeType: 'FRANCHISE'; nodeId: string };

// Return window is now driven by RETURN_WINDOW_DAYS env. Prod default
// is 14 days; dev can override to a small fractional value (e.g. 0.0014
// ≈ 2 minutes) to test the post-window commission confirm path quickly.
// Read once at constructor; not hot-reloaded — process restart picks up
// the new value. Computed at use site to avoid stale-module issues.
//
// Phase 80 (2026-05-22) — acceptance audit Gap #1/#9. Pre-Phase-80
// this was a hardcoded 24 * 60 * 60 * 1000 (24h) constant while the
// SLA cron used ORDER_ACCEPTANCE_SLA_MINUTES (default 60min). The
// deadline field said "24 hours from now" but the cron auto-rejected
// at 60 minutes. Phase 80 unifies both on the env value — the field
// is stamped from it and the cron filters by acceptDeadlineAt.
// The legacy 24h constant is intentionally retained as a fallback
// constant for one piece of code (verifyOrder, where slaMinutes=0
// disables the cron but a finite deadline is still helpful).
const ACCEPT_DEADLINE_FALLBACK_MS = 24 * 60 * 60 * 1000;

/**
 * How many pre-ship "proof of dispatch" photos a seller must upload
 * before they can mark an order SHIPPED. Hard-block in the API +
 * matched UI guard in the seller portal. Tuned with ops if the rate
 * of false damage claims justifies more / fewer angles per shipment.
 *
 * Phase 82 (2026-05-23) — pack/ship audit Gap #20. This constant is
 * now the fallback only — the actual value comes from
 * `SHIPMENT_EVIDENCE_REQUIRED_PHOTOS` env so ops can tune by tier
 * without a redeploy. See `acceptDeadlineMs` for the same pattern.
 */
const SHIPMENT_EVIDENCE_REQUIRED_FALLBACK = 4;

// Customer-friendly status label mapping
const ORDER_STATUS_LABELS: Record<string, string> = {
  PLACED: 'Order Placed',
  PENDING_VERIFICATION: 'Processing',
  VERIFIED: 'Order Confirmed',
  ROUTED_TO_SELLER: 'Being Prepared',
  SELLER_ACCEPTED: 'Order Accepted',
  PACKED: 'Packed & Ready',
  SHIPPED: 'Shipped',
  DISPATCHED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  // Phase 234 — distinct from the healthy 'Processing' (PENDING_VERIFICATION).
  // An exception order is being manually reviewed; the customer should see a
  // label that doesn't read identically to a normal in-flight order.
  EXCEPTION_QUEUE: 'Being Reviewed',
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  // Memoised at construct time. Prod sets RETURN_WINDOW_DAYS=14 in env;
  // dev/demo overrides with a fractional day to test the post-window
  // commission confirm path without waiting two weeks.
  private readonly returnWindowMs: number;

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepo: OrderRepository,
    private readonly eventBus: EventBusService,
    private readonly catalogFacade: CatalogPublicFacade,
    // Orders↔Franchise is a constructor-level circular provider dependency
    // (FranchiseOrdersService injects OrdersService via the same param-level
    // forwardRef). Mirror it here so this facade resolves regardless of
    // module init order.
    @Inject(forwardRef(() => FranchisePublicFacade))
    private readonly franchiseFacade: FranchisePublicFacade,
    private readonly prisma: PrismaService,
    // Phase 0 (PR 0.7) — inverse of `confirmReservation`. Replaces
    // the previous reject/cancel/reassign paths that asymmetrically
    // restored only one of the two stock ledgers, drifting the seller
    // mapping from the variant aggregate. See StockRestoreService for
    // the symmetric contract.
    private readonly stockRestore: StockRestoreService,
    private readonly env: EnvService,
    private readonly taxFacade: TaxPublicFacade,
    // Phase 68 (2026-05-22) — audit Gap #11. @Optional so the
    // existing legacy boot path (which doesn't yet inject
    // AuditModule into OrdersModule) doesn't break — we register
    // the import in the same phase, but keeping the dependency
    // optional means the verifyOrder path stays alive even if a
    // bootstrap-time wiring change removes AuditModule.
    @Optional()
    private readonly auditFacade?: AuditPublicFacade,
    // Phase 74 (2026-05-22) — Phase 73 audit Gap #1. Optional so the
    // legacy boot path doesn't break; rejectOrder no-ops the refund
    // step when this isn't injected (logs a loud warning).
    @Optional()
    private readonly refundInstructions?: RefundInstructionService,
    // Phase 84 (2026-05-23) — order timeline / status history.
    // Every status-transition method calls into this recorder so the
    // append-only `order_status_history` row commits inside the
    // same tx as the state change. Optional so the legacy boot path
    // (without OrderTimelineService wired) doesn't break — service
    // methods no-op the recorder call when undefined.
    @Optional()
    private readonly timeline?: OrderTimelineService,
    // Phase 88 (2026-05-23) — typed shipment-evidence orchestrator.
    // @Optional so the existing spec harnesses that instantiate
    // OrdersService directly (without DI) keep working; the gate +
    // freeze + archive paths no-op gracefully when undefined.
    @Optional()
    private readonly shipmentEvidence?: ShipmentEvidenceService,
    // Phase 89 (2026-05-23) — EWB ship-block gate. @Optional for the
    // same reason — when missing the SHIPPED transition behaves as
    // pre-Phase-89 (no EWB enforcement) so legacy specs still run.
    @Optional()
    private readonly ewayBill?: EWayBillService,
    // Phase 168 (COD Mark-Paid audit #15) — @Optional so legacy specs that
    // construct OrdersService directly don't break; the orderStatus-mismatch
    // path falls back to a warn log when undefined.
    @Optional()
    private readonly paymentOps?: PaymentOpsFacade,
    // Wallet refund on full-master cancel. @Optional so spec harnesses that
    // construct OrdersService directly don't break; WalletModule provides it
    // in the real app.
    @Optional()
    private readonly walletFacade?: WalletPublicFacade,
  ) {
    const days = this.env.getNumber('RETURN_WINDOW_DAYS', 14);
    this.returnWindowMs = Math.round(days * 24 * 60 * 60 * 1000);
    this.logger.log(
      `Return window: ${days} day(s) (${this.returnWindowMs}ms)`,
    );
  }

  /**
   * Phase 80 (2026-05-22) — acceptance audit Gap #1/#9. Single source
   * of truth for the deadline that both seller-accept stamping AND
   * the SLA cron consume. Reads `ORDER_ACCEPTANCE_SLA_MINUTES` from
   * env on every call so a hot-reload (`/admin/config` future) picks
   * up the new value without a restart.
   *
   * Special case: when the env value is `0` (operator disables the
   * cron), the field still needs *a* deadline so the UI countdown
   * doesn't show NaN. We fall back to the 24h pre-Phase-80 default
   * for that case.
   */
  private acceptDeadlineMs(): number {
    const minutes = this.env.getNumber('ORDER_ACCEPTANCE_SLA_MINUTES', 60);
    if (minutes <= 0) return ACCEPT_DEADLINE_FALLBACK_MS;
    return minutes * 60 * 1000;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Admin methods
  // ────────────────────────────────────────────────────────────────────────

  async listOrders(filters: {
    page: number;
    limit: number;
    paymentStatus?: string;
    fulfillmentStatus?: string;
    acceptStatus?: string;
    orderStatus?: string;
    search?: string;
    // Phase 38 (admin breadth) — restrict to orders with ≥1 sub-order whose
    // seller is in the admin's seller-type scope. undefined = unrestricted.
    allowedSellerTypes?: ('D2C' | 'RETAIL')[];
  }) {
    const {
      page,
      limit,
      paymentStatus,
      fulfillmentStatus,
      acceptStatus,
      orderStatus,
      search,
      allowedSellerTypes,
    } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.MasterOrderWhereInput = {};
    if (paymentStatus) where.paymentStatus = paymentStatus as any;
    if (orderStatus) where.orderStatus = orderStatus as any;
    // Option A — an ONLINE order sits at PENDING_PAYMENT before its gateway
    // payment is captured: it's a pre-payment cart, not a real order, so it
    // must not pollute the default admin list (ops only acts on paid orders).
    // Hidden from the default view; shown only when explicitly requested (the
    // "Pending Payment" tab passes orderStatus=PENDING_PAYMENT). Keyed on
    // orderStatus, NOT paymentStatus='PENDING' — COD orders are legitimately
    // PLACED + PENDING and must stay visible. Paid-but-stuck online orders are
    // still recovered by PaymentStatusPollerService, independent of this view.
    if (!orderStatus && !paymentStatus) {
      where.orderStatus = { not: 'PENDING_PAYMENT' } as any;
    }
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const subOrderFilter: Prisma.SubOrderWhereInput = {};
    if (fulfillmentStatus)
      subOrderFilter.fulfillmentStatus = fulfillmentStatus as any;
    if (acceptStatus) subOrderFilter.acceptStatus = acceptStatus as any;
    // Phase 38 (admin breadth) — scope to in-type sellers, composed inside the
    // sub-order `some`: an order matches when it has ≥1 sub-order that is both
    // in-scope AND satisfies the status filters above.
    if (allowedSellerTypes && allowedSellerTypes.length > 0) {
      (subOrderFilter as any).seller = {
        sellerType: { in: allowedSellerTypes },
      };
    }
    if (Object.keys(subOrderFilter).length > 0)
      where.subOrders = { some: subOrderFilter };

    const [orders, total] = await Promise.all([
      this.orderRepo.findMasterOrders(where, skip, limit),
      this.orderRepo.countMasterOrders(where),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOrder(id: string) {
    const order = await this.orderRepo.findMasterOrderByIdWithDetails(id);
    if (!order) throw new NotFoundAppException('Order not found');

    // Phase 79 (2026-05-22) — history audit Gaps #2/#5/#9/#13/#14.
    //   • Embeds the FIRST page of enriched reassignment history. The
    //     full paginated read is via /admin/orders/:id/reassignment-history.
    //   • Enrichment is batched (Gap #9) — distinct ids collected in
    //     one pass, then one findMany per actor table. 20 logs → 4
    //     queries total instead of 60+.
    //   • Includes the franchise-side enrichment (Gap #2) and the
    //     admin actor name (Gap #1) — pre-Phase-79 the read path only
    //     enriched sellers, so franchise rows displayed the raw uuid.
    //   • Sub-order context + new-sub-order linkage (Gap #5/#13) so
    //     the UI can render "Sub-order #N (3 items)" + "→ created new
    //     sub-order #M".
    const enrichedLogs = await this.enrichReassignmentLogs(
      await this.orderRepo.findReassignmentLogs(id, {
        limit: 50,
      }),
    );

    // When a coupon was applied, look up the underlying Discount so the
    // super-admin order detail can explain exactly what rule fired.
    let discount: any = null;
    if (order.discountCode) {
      discount = await this.prisma.discount.findUnique({
        where: { code: order.discountCode },
        include: {
          products: {
            include: {
              product: {
                select: {
                  id: true,
                  title: true,
                  basePrice: true,
                  images: {
                    where: { isPrimary: true },
                    select: { url: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });
    }

    // Phase B (P0.1, P0.5) — Discount & GST Breakdown.
    // Attach the per-order discount allocation, item-level allocation,
    // tax snapshots, and liability-ledger rows so the admin order
    // detail UI can render the breakdown card.
    //
    // For legacy orders (placed before Phase B / no allocation) all
    // four arrays come back empty, and the UI falls back to showing
    // just the legacy `discountAmount` field on MasterOrder.
    const [orderDiscounts, orderItemDiscounts, taxSnapshots, liabilityLedger] =
      await Promise.all([
        this.prisma.orderDiscount.findMany({
          where: { masterOrderId: id },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.orderItemDiscount.findMany({
          where: { masterOrderId: id },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.orderItemTaxSnapshot.findMany({
          where: { masterOrderId: id },
        }),
        this.prisma.discountLiabilityLedger.findMany({
          where: { masterOrderId: id },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    // Phase 159c (audit L1) — surface the affiliate referral attribution +
    // its linked commission so the admin order detail can show "Attributed to
    // Affiliate X via COUPON 'AFXYZ' — commission ₹500, PAID". Null when the
    // order wasn't affiliate-attributed.
    const attributionRow = await this.prisma.referralAttribution.findUnique({
      where: { orderId: id },
      select: {
        id: true,
        affiliateId: true,
        source: true,
        code: true,
        status: true,
        capturedAt: true,
        affiliate: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });
    let affiliateAttribution: any = null;
    if (attributionRow) {
      const commission = await this.prisma.affiliateCommission.findUnique({
        where: { orderId: id },
        select: {
          id: true,
          status: true,
          commissionAmount: true,
          commissionPercentage: true,
        },
      });
      affiliateAttribution = { ...attributionRow, commission };
    }

    return {
      ...order,
      // Wallet-aware payment label (mirrors the customer + seller views). A
      // full-wallet order reads "Paid by Wallet" instead of the raw COD/ONLINE
      // base method; a partial wallet order shows "… (Wallet ₹X applied)". The
      // raw `paymentMethod` is still spread above for anything that needs it.
      paymentMethodLabel: this.deriveEffectivePaymentLabel(order),
      reassignmentLogs: enrichedLogs,
      discount,
      // Phase B / Phase C — discount-aware financial breakdown
      discountBreakdown: {
        orderDiscounts,
        orderItemDiscounts,
        taxSnapshots,
        liabilityLedger,
      },
      // Phase 159c — affiliate attribution panel data (null if none).
      affiliateAttribution,
    };
  }

  /**
   * Verify an order: validate, set status to VERIFIED, then attempt allocation.
   * If all items are serviceable, confirm reservations and route to sellers.
   * If some items are unserviceable, move to EXCEPTION_QUEUE.
   *
   * Phase 68 (2026-05-22) — single $transaction wraps the FSM flip +
   * allocation reads + final status flip + sub-order deadline writes
   * (audit Gaps #7 + #12). Pre-Phase-68 the master was flipped to
   * VERIFIED before the allocation loop; a partial failure mid-loop
   * left the order in VERIFIED with missing acceptDeadlineAt on the
   * tail sub-orders. The transactional version commits all three
   * status flips together — either the order is fully VERIFIED +
   * routed (or EXCEPTION_QUEUEd) with every sub-order deadline set,
   * or it stays at the pre-call status and the caller retries.
   *
   * Phase 68 also blocks VOIDED payment status (audit Gap #23) and
   * checks the queue claim — if another admin holds the verification
   * claim on this order, the direct /admin/orders/:id/verify path
   * cannot bypass it (audit Gaps #4 + #5).
   */
  async verifyOrder(
    id: string,
    adminId: string,
    remarks?: string,
    actorContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const order = await this.orderRepo.findMasterOrderById(id);
    if (!order) throw new NotFoundAppException('Order not found');
    // Phase 0 / C7 — route through the FSM rather than a raw string
    // compare. The transition table allows PLACED → VERIFIED plus a
    // few recovery edges (PENDING_VERIFICATION, EXCEPTION_QUEUE);
    // every other source state throws with a uniform error message.
    assertTransition('OrderStatus', order.orderStatus, 'VERIFIED');
    // Phase 68 (audit Gap #23) — VOIDED is now also rejected. A
    // PAID-then-refunded order shouldn't be re-verifiable; the
    // CANCELLED check alone left an edge where an order voided
    // mid-flow could still slip through.
    if (
      order.paymentStatus === 'CANCELLED' ||
      order.paymentStatus === 'VOIDED'
    ) {
      throw new BadRequestAppException(
        `Cannot verify a ${order.paymentStatus.toLowerCase()} order`,
      );
    }

    // Phase 68 (audit Gaps #4 + #5) — cross-path claim guard. If a
    // verification-queue claim is live and held by a different
    // admin, the direct /admin/orders/:id/verify bypass must NOT
    // win. Two cases pass:
    //   • No live claim at all (legacy / direct-verify flow).
    //   • Live claim is held by the caller (they came via
    //     /admin/verification/orders/:id/approve OR claimed via
    //     /admin/verification/claim-next then routed through here).
    if (
      (order as any).claimedByAdminId &&
      (order as any).claimedByAdminId !== adminId &&
      (order as any).claimExpiresAt &&
      new Date((order as any).claimExpiresAt) > new Date()
    ) {
      throw new BadRequestAppException(
        'This order is currently held by another verifier — wait for the claim to release or contact them.',
      );
    }

    const now = new Date();
    const addressSnapshot = order.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;

    // Phase 68 (audit Gap #7) — wrap everything that mutates order
    // state inside one $transaction. catalogFacade.allocate reads
    // committed catalog rows; we keep those reads outside so the
    // tx stays short, but every order/subOrder write happens
    // inside the tx.
    //
    // Allocation results are computed first (pure reads) so the
    // tx body only has writes — bounded, predictable runtime.
    //
    // Phase 69 (audit Gap #8) — also capture the allocated
    // (mappingId, quantity) per item so the post-tx
    // re-reservation pass can guarantee each item has a live
    // CONFIRMED reservation on the right mapping.
    const subOrderAllocations: Array<{
      subOrderId: string;
      serviceable: boolean;
      perItem: Array<{
        orderItemId: string;
        productId: string;
        variantId: string | null;
        quantity: number;
        mappingId: string | null;
      }>;
    }> = [];
    if (customerPincode) {
      for (const subOrder of order.subOrders) {
        let subOrderServiceable = true;
        const perItem: Array<{
          orderItemId: string;
          productId: string;
          variantId: string | null;
          quantity: number;
          mappingId: string | null;
        }> = [];
        for (const item of subOrder.items) {
          try {
            const allocation = await this.catalogFacade.allocate({
              productId: item.productId,
              variantId: item.variantId ?? undefined,
              customerPincode,
              quantity: item.quantity,
            });
            if (!allocation.serviceable || !allocation.primary) {
              subOrderServiceable = false;
              break;
            }
            perItem.push({
              orderItemId: item.id,
              productId: item.productId,
              variantId: item.variantId ?? null,
              quantity: item.quantity,
              mappingId: allocation.primary.mappingId,
            });
          } catch {
            subOrderServiceable = false;
            break;
          }
        }
        subOrderAllocations.push({
          subOrderId: subOrder.id,
          serviceable: subOrderServiceable,
          perItem,
        });
      }
    }

    const allRoutedSuccessfully =
      Boolean(customerPincode) &&
      subOrderAllocations.length > 0 &&
      subOrderAllocations.every((a) => a.serviceable);
    const acceptDeadlineAt = new Date(now.getTime() + this.acceptDeadlineMs());
    const finalStatus = !customerPincode
      ? 'EXCEPTION_QUEUE'
      : allRoutedSuccessfully
        ? 'ROUTED_TO_SELLER'
        : 'EXCEPTION_QUEUE';

    // Phase 234 (Exception Queue audit) — derive a STRUCTURED exception reason +
    // detail to persist on the order. Pre-234 the reason existed only inside a
    // fire-and-forget event payload (no consumer), so neither admins nor
    // analytics could answer "why is this in exception".
    const unserviceableCount = subOrderAllocations.filter(
      (a) => !a.serviceable,
    ).length;
    const exceptionReason:
      | 'NO_PINCODE_ON_ORDER'
      | 'PINCODE_UNSERVICEABLE'
      | null =
      finalStatus !== 'EXCEPTION_QUEUE'
        ? null
        : !customerPincode
          ? 'NO_PINCODE_ON_ORDER'
          : 'PINCODE_UNSERVICEABLE';
    const exceptionDetail =
      finalStatus !== 'EXCEPTION_QUEUE'
        ? null
        : !customerPincode
          ? 'Customer address has no pincode — order cannot be routed.'
          : `Unserviceable after verification: ${unserviceableCount} of ${subOrderAllocations.length} sub-order(s) had no eligible node.`;

    await this.prisma.$transaction(async (tx) => {
      // Step 1: stamp VERIFIED + verifier identity.
      await tx.masterOrder.update({
        where: { id },
        data: {
          orderStatus: 'VERIFIED',
          verified: true,
          verifiedAt: now,
          verifiedBy: adminId,
          verificationRemarks: remarks || null,
        },
      });

      // Step 2: per-sub-order accept deadline (only for serviceable).
      for (const alloc of subOrderAllocations) {
        if (!alloc.serviceable) continue;
        await tx.subOrder.update({
          where: { id: alloc.subOrderId },
          data: { acceptDeadlineAt },
        });
      }

      // Step 3: final order status flip (one write — VERIFIED →
      // ROUTED_TO_SELLER or EXCEPTION_QUEUE). A separate update so
      // the FSM history captures both transitions.
      //
      // Phase 234 — FSM-guard the edge (was a raw write that bypassed the
      // transition map — audit "exception transition has no FSM check") and,
      // when parking the order, persist the structured exception reason + the
      // real time-in-queue clock (exceptionEnteredAt) so routing-health ages
      // from when it ENTERED the queue, not from order placement.
      assertTransition('OrderStatus', 'VERIFIED', finalStatus as any);
      await tx.masterOrder.update({
        where: { id },
        data: {
          orderStatus: finalStatus as any,
          ...(finalStatus === 'EXCEPTION_QUEUE'
            ? {
                exceptionReason: exceptionReason as any,
                exceptionReasonDetail: exceptionDetail,
                exceptionEnteredAt: now,
              }
            : {}),
        },
      });

      // Phase 74 (Phase 73 audit Gap #3/#18) — append-only decision
      // row. Differs from the audit_logs ORDER_VERIFIED row (which
      // is event-shaped); this is verification-specific, queryable
      // per-order, and indexed by (decision, decidedAt) for BI.
      await tx.orderVerificationDecision.create({
        data: {
          masterOrderId: id,
          decision: 'APPROVED',
          decidedBy: adminId,
          remarks: remarks ?? null,
          metadataJson: {
            previousOrderStatus: order.orderStatus,
            finalStatus,
            servicedSubOrderCount: subOrderAllocations.filter((a) => a.serviceable).length,
            subOrderCount: order.subOrders.length,
            riskBand: (order as any).verificationRiskBand ?? null,
            riskScore: (order as any).verificationRiskScore ?? null,
          },
        },
      });
    });

    // Phase 69 (audit Gap #8) — stock re-reservation pass for
    // serviceable sub-orders. Runs only when the order routed to
    // sellers (EXCEPTION_QUEUE skips this — those items aren't
    // shippable). The catalog facade's helper is idempotent: when
    // a CONFIRMED reservation on the same mapping already exists,
    // it returns the same id; otherwise it reserves + confirms
    // fresh. Failure here is treated as a soft warning: the order
    // is already VERIFIED + ROUTED and the seller-accept path
    // can retry stock reservation. We log + emit a structured
    // ops event so the discrepancy surfaces rather than silently
    // shipping under-reserved.
    if (finalStatus === 'ROUTED_TO_SELLER') {
      const reservationFailures: Array<{ orderItemId: string; reason: string }> = [];
      for (const alloc of subOrderAllocations) {
        if (!alloc.serviceable) continue;
        for (const itemAlloc of alloc.perItem) {
          if (!itemAlloc.mappingId) continue;
          try {
            const result = await this.catalogFacade.ensureConfirmedReservationAtVerify({
              orderId: id,
              mappingId: itemAlloc.mappingId,
              quantity: itemAlloc.quantity,
              customerId: order.customerId,
            });
            // If the helper reserved fresh, update the OrderItem
            // pointer so refund-by-item still resolves to the
            // currently-active reservation.
            if (!result.reused) {
              await this.prisma.orderItem
                .update({
                  where: { id: itemAlloc.orderItemId },
                  data: { stockReservationId: result.reservationId } as any,
                })
                .catch(() => undefined);
            }
          } catch (err) {
            const reason = (err as Error).message;
            reservationFailures.push({ orderItemId: itemAlloc.orderItemId, reason });
            this.logger.warn(
              `Re-reservation failed at verify for order ${id} item ${itemAlloc.orderItemId}: ${reason}`,
            );
          }
        }
      }
      if (reservationFailures.length > 0) {
        try {
          await this.eventBus.publish({
            eventName: 'orders.verify.reservation_gap',
            aggregate: 'MasterOrder',
            aggregateId: id,
            occurredAt: now,
            payload: {
              masterOrderId: id,
              orderNumber: order.orderNumber,
              failures: reservationFailures,
            },
          });
        } catch { /* best-effort */ }
      }
    }

    // Phase 68 (audit Gap #11) — single-order audit row. Pre-Phase-68
    // only bulk-approve audited; single-order approve / direct-verify
    // was invisible. The row carries the verifier id, the
    // before/after status, and the risk-band snapshot so compliance
    // can reconstruct "who approved a RED-banded order at 22:00".
    if (this.auditFacade) {
      this.auditFacade
        .writeAuditLog({
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'ORDER_VERIFIED',
          module: 'orders',
          resource: 'master_order',
          resourceId: id,
          oldValue: {
            orderStatus: order.orderStatus,
            verified: false,
          },
          newValue: {
            orderStatus: finalStatus,
            verified: true,
            verifiedAt: now.toISOString(),
            verifiedBy: adminId,
          },
          metadata: {
            orderNumber: order.orderNumber,
            riskBand: (order as any).verificationRiskBand ?? null,
            riskScore: (order as any).verificationRiskScore ?? null,
            remarks: remarks ?? null,
            subOrderCount: order.subOrders.length,
            servicedSubOrderCount: subOrderAllocations.filter((a) => a.serviceable).length,
          },
          ipAddress: actorContext?.ipAddress,
          userAgent: actorContext?.userAgent,
        })
        .catch((err: any) =>
          this.logger.warn(
            `Audit log write for ORDER_VERIFIED failed (order ${id}): ${(err as Error).message}`,
          ),
        );
    }

    // Phase 84 (2026-05-23) — timeline event. Post-tx best-effort to
    // match the audit-log placement. Idempotency key derived from
    // master id + verifier so an outbox replay doesn't duplicate.
    if (this.timeline) {
      await this.timeline
        .record({
          masterOrderId: id,
          eventType: 'ORDER_VERIFIED',
          oldStatus: order.orderStatus,
          newStatus: finalStatus,
          actorType: 'ADMIN',
          actorId: adminId,
          note: remarks ?? null,
          metadata: {
            riskBand: (order as any).verificationRiskBand ?? null,
            riskScore: (order as any).verificationRiskScore ?? null,
          },
          idempotencyKey: `order-verified:${id}:${now.toISOString()}`,
        })
        .catch((err) =>
          this.logger.warn(
            `Timeline record for ORDER_VERIFIED failed (order ${id}): ${(err as Error).message}`,
          ),
        );
    }

    // Post-tx domain events — best-effort, never block the response.
    if (finalStatus === 'ROUTED_TO_SELLER') {
      try {
        await this.eventBus.publish({
          eventName: 'orders.master.routed',
          aggregate: 'MasterOrder',
          aggregateId: id,
          occurredAt: now,
          payload: {
            masterOrderId: id,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            orderStatus: 'ROUTED_TO_SELLER',
            verifiedBy: adminId,
            subOrderCount: order.subOrders.length,
          },
        });
      } catch { /* best-effort */ }
    } else {
      try {
        await this.eventBus.publish({
          eventName: 'orders.master.exception',
          aggregate: 'MasterOrder',
          aggregateId: id,
          occurredAt: now,
          payload: {
            masterOrderId: id,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            orderStatus: 'EXCEPTION_QUEUE',
            // Phase 234 — structured reason code so the (newly-added) consumer
            // can route notifications + ops can group by cause.
            exceptionReason,
            reason: exceptionDetail,
          },
        });
      } catch { /* best-effort */ }

      // Phase 234 — hash-chained audit row for the EXCEPTION_QUEUE transition
      // (pre-234 nothing was written to the tamper-evident chain). Best-effort.
      if (this.auditFacade) {
        await this.auditFacade
          .writeAuditLog({
            actorId: adminId ?? 'SYSTEM',
            actorRole: adminId ? 'ADMIN' : 'SYSTEM',
            action: 'ORDER_EXCEPTION_QUEUED',
            module: 'orders',
            resource: 'MasterOrder',
            resourceId: id,
            oldValue: { orderStatus: 'VERIFIED' },
            newValue: {
              orderStatus: 'EXCEPTION_QUEUE',
              exceptionReason,
              exceptionReasonDetail: exceptionDetail,
            },
          } as any)
          .catch(() => undefined);
      }
    }

    return this.getOrder(id);
  }

  /**
   * Phase 74 (2026-05-22) — Phase 73 approve/reject audit closing.
   *
   * Reject a placed order. New shape:
   *   • Takes (id, adminId, reason) — pre-Phase-74 took only id, so
   *     the order had no rejecter id and no reason text.
   *   • Status flips to REJECTED (was CANCELLED) so analytics +
   *     refund saga + customer notifications can distinguish from
   *     customer-cancel.
   *   • previousPaymentStatus snapshot stamped before the
   *     paymentStatus column is overwritten — refund saga reads it
   *     to decide "was this order PAID? do we owe a refund?"
   *   • All status writes happen inside the existing tx; status
   *     precondition is re-checked inside the tx via the WHERE
   *     clause of the updateMany so two concurrent rejects can't
   *     both win.
   *   • Sub-order rejectionReason column (which existed but was
   *     never written) now carries the reason text for the seller-
   *     visible surface.
   *   • OrderVerificationDecision row written inside tx — append-
   *     only audit trail per order.
   *   • Refund saga enqueued post-tx if previousPaymentStatus===PAID;
   *     idempotency keyed on `verification-reject:<orderId>`.
   *   • Franchise unreserve failures emit an
   *     `orders.franchise.unreserve_required` event for the retry
   *     worker (previously silently swallowed).
   *   • Audit log row written + `orders.master.rejected` event
   *     emitted on success.
   *
   * Claim-guard: if a verification queue claim is held by another
   * admin, the reject is blocked (mirrors verifyOrder's Phase 68
   * guard so the queue claim is enforceable across both paths).
   */
  /**
   * Phase 75 (2026-05-22) — Phase 73 reject audit Gap #23.
   *
   * Routing preview surface for the admin UI. Pre-Phase-75 the
   * verifier clicked "Verify & Route" without knowing where the
   * order would route to. Now the order detail page can call this
   * and show per-item "Will route to: Seller X / Y km from buyer"
   * before the verifier commits.
   *
   * Uses `previewServiceability` (read-only allocator) — does NOT
   * mutate AllocationLog. Safe to call repeatedly from the UI.
   */
  async previewRouting(orderId: string): Promise<{
    masterOrderId: string;
    customerPincode: string | null;
    items: Array<{
      orderItemId: string;
      productId: string;
      variantId: string | null;
      quantity: number;
      productTitle: string;
      serviceable: boolean;
      primary: {
        mappingId: string;
        sellerId: string | null;
        sellerShopName: string | null;
        distanceKm: number | null;
        nodeType: string;
      } | null;
      reason: string | null;
    }>;
    summary: {
      totalItems: number;
      serviceableItems: number;
      unserviceableItems: number;
    };
  }> {
    const order = await this.orderRepo.findMasterOrderById(orderId);
    if (!order) throw new NotFoundAppException('Order not found');
    const addressSnapshot = order.shippingAddressSnapshot as any;
    const customerPincode: string | null = addressSnapshot?.postalCode ?? null;

    const items: Array<any> = [];
    for (const subOrder of order.subOrders ?? []) {
      for (const item of subOrder.items ?? []) {
        if (!customerPincode) {
          items.push({
            orderItemId: item.id,
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            productTitle: (item as any).productTitle ?? '',
            serviceable: false,
            primary: null,
            reason: 'Customer pincode missing from shipping address',
          });
          continue;
        }
        try {
          const allocation = await this.catalogFacade.previewServiceability({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            customerPincode,
            quantity: item.quantity,
          });
          items.push({
            orderItemId: item.id,
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            productTitle: (item as any).productTitle ?? '',
            serviceable: allocation.serviceable,
            primary: allocation.primary
              ? {
                  mappingId: allocation.primary.mappingId,
                  sellerId: (allocation.primary as any).sellerId ?? null,
                  sellerShopName: (allocation.primary as any).sellerShopName ?? null,
                  distanceKm: (allocation.primary as any).distanceKm ?? null,
                  nodeType: (allocation.primary as any).nodeType ?? 'SELLER',
                }
              : null,
            reason: !allocation.serviceable
              ? ((allocation as any).reason ?? 'No serviceable mapping found')
              : null,
          });
        } catch (err) {
          items.push({
            orderItemId: item.id,
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            productTitle: (item as any).productTitle ?? '',
            serviceable: false,
            primary: null,
            reason: (err as Error).message,
          });
        }
      }
    }
    const serviceableCount = items.filter((i) => i.serviceable).length;
    return {
      masterOrderId: orderId,
      customerPincode,
      items,
      summary: {
        totalItems: items.length,
        serviceableItems: serviceableCount,
        unserviceableItems: items.length - serviceableCount,
      },
    };
  }

  async rejectOrder(
    id: string,
    adminId?: string,
    reason?: string,
    actorContext?: { ipAddress?: string; userAgent?: string },
  ) {
    const order = await this.orderRepo.findMasterOrderById(id);
    if (!order) throw new NotFoundAppException('Order not found');
    // Phase 74 — FSM path consistent with verifyOrder.
    assertTransition('OrderStatus', order.orderStatus, 'REJECTED');
    if (order.paymentStatus === 'CANCELLED') {
      throw new BadRequestAppException('Order is already cancelled');
    }

    // Phase 74 (Gap #5) — cross-path claim guard. If a different
    // verifier holds a live queue claim on this order, the direct
    // /admin/orders/:id/reject-order path must not bypass it.
    // Calls without adminId (legacy callers / tests) skip the
    // check.
    if (
      adminId &&
      (order as any).claimedByAdminId &&
      (order as any).claimedByAdminId !== adminId &&
      (order as any).claimExpiresAt &&
      new Date((order as any).claimExpiresAt) > new Date()
    ) {
      throw new BadRequestAppException(
        'This order is currently held by another verifier — wait for the claim to release or contact them.',
      );
    }

    const previousPaymentStatus = order.paymentStatus;
    const previousOrderStatus = order.orderStatus;
    const orderNumber = order.orderNumber;
    const customerId = (order as any).customerId as string;
    const totalAmount = Number(order.totalAmount);
    const totalAmountInPaise = BigInt(
      Math.round(Number(order.totalAmount) * 100),
    );

    const now = new Date();

    await this.orderRepo.executeTransaction(async (tx) => {
      // Phase 74 (Gap #20) — status precondition re-checked inside
      // the tx via the WHERE clause. Two concurrent rejects can no
      // longer both pass the outer findMasterOrderById guard and
      // both flip the column; updateMany returns count=0 for the
      // loser and we throw.
      const updated = await tx.masterOrder.updateMany({
        where: {
          id,
          paymentStatus: { not: 'CANCELLED' },
          orderStatus: { notIn: ['ROUTED_TO_SELLER', 'SELLER_ACCEPTED', 'DISPATCHED', 'DELIVERED', 'REJECTED'] },
        },
        data: {
          paymentStatus: 'CANCELLED',
          orderStatus: 'REJECTED',
          previousPaymentStatus,
          rejectedAt: now,
          rejectedBy: adminId ?? null,
          rejectionReason: reason ?? null,
        },
      });
      if (updated.count === 0) {
        throw new BadRequestAppException(
          'Order state changed concurrently — please reload and retry',
        );
      }

      for (const so of order.subOrders) {
        await tx.subOrder.update({
          where: { id: so.id },
          data: {
            paymentStatus: 'CANCELLED',
            acceptStatus: 'REJECTED',
            // Phase 74 (Gap #2 follow-on) — column existed but was
            // never written. Now carries the reason so the seller-
            // visible surface (and any seller-side audit) has it.
            rejectionReason: reason ?? null,
            // Phase 75 (Phase 73 audit Gap #10) — keep
            // commissionProcessed: true so the existing settlement
            // sweep (which filters `commissionProcessed: false`)
            // continues to skip rejected rows. The semantic clarity
            // lives on the new commissionDecision column, which is
            // the canonical "actual decision" for analytics + audit.
            commissionProcessed: true,
            commissionDecision: 'NOT_APPLICABLE',
          } as any,
        });
      }

      // Phase 74 (Gap #3/#18) — append-only audit row.
      await tx.orderVerificationDecision.create({
        data: {
          masterOrderId: id,
          decision: 'REJECTED',
          decidedBy: adminId ?? 'SYSTEM',
          reason: reason ?? null,
          metadataJson: {
            previousOrderStatus,
            previousPaymentStatus,
            totalAmount,
          },
        },
      });

      // Phase 0 (PR 0.7) — symmetric reservation-ledger restore.
      await this.stockRestore.restoreForOrder(tx, id);
    });

    // ── Post-tx side effects ────────────────────────────────────

    // Phase 74 (Gap #1) — refund saga for prepaid orders. The
    // RefundInstructionService.createSplitForRefund handles the
    // wallet + gateway split automatically and is idempotent on
    // the key, so a retried reject won't double-refund. COD orders
    // skip this branch (previousPaymentStatus !== 'PAID').
    if (previousPaymentStatus === 'PAID' && this.refundInstructions && totalAmountInPaise > 0n) {
      try {
        await this.refundInstructions.createSplitForRefund({
          sourceType: 'VERIFICATION_REJECTION' as any,
          sourceId: id,
          sourceLabel: orderNumber ?? id,
          customerId,
          masterOrderId: id,
          amountInPaise: totalAmountInPaise,
          baseIdempotencyKey: `verification-reject:${id}`,
          // Phase 258 — a rejection always happens BEFORE seller acceptance, so
          // the full paid amount is returned to the customer's wallet as store
          // credit (not reversed to the card). Pre-fix this split wallet+gateway.
          forceFullWallet: true,
        });
      } catch (err) {
        // Refund failure must not roll back the rejection — the
        // order is already terminal. Log + emit a recovery event
        // so finance ops can step in.
        this.logger.error(
          `Refund saga creation failed for rejected order ${id}: ${(err as Error).message}`,
        );
        this.eventBus
          .publish({
            eventName: 'orders.refund.required',
            aggregate: 'MasterOrder',
            aggregateId: id,
            occurredAt: new Date(),
            payload: {
              masterOrderId: id,
              orderNumber,
              customerId,
              amountInPaise: totalAmountInPaise.toString(),
              reason: 'VERIFICATION_REJECTION',
              error: (err as Error).message,
            },
          })
          .catch(() => undefined);
      }
    } else if (previousPaymentStatus === 'PAID' && !this.refundInstructions) {
      this.logger.error(
        `Order ${id} rejected with paymentStatus=PAID but RefundInstructionService not injected — manual refund required`,
      );
    }

    // Phase 74 (Gap #11) — franchise unreserve. Pre-Phase-74 the
    // best-effort .catch swallowed errors. Now: emit a retry
    // event for any failure so the franchise stock isn't orphaned
    // silently.
    for (const so of order.subOrders) {
      const nodeType = (so as any).fulfillmentNodeType ?? 'SELLER';
      const franchiseId: string | null = (so as any).franchiseId ?? null;
      if (nodeType !== 'FRANCHISE' || !franchiseId) continue;
      for (const item of so.items) {
        try {
          await this.franchiseFacade.unreserveStock(
            franchiseId,
            item.productId,
            item.variantId ?? null,
            item.quantity,
            id,
          );
        } catch (err) {
          this.logger.warn(
            `Franchise unreserve failed for order ${id} item ${item.productId}: ${(err as Error).message}`,
          );
          this.eventBus
            .publish({
              eventName: 'orders.franchise.unreserve_required',
              aggregate: 'MasterOrder',
              aggregateId: id,
              occurredAt: new Date(),
              payload: {
                masterOrderId: id,
                orderNumber,
                franchiseId,
                productId: item.productId,
                variantId: item.variantId ?? null,
                quantity: item.quantity,
                reason: (err as Error).message,
              },
            })
            .catch(() => undefined);
        }
      }
    }

    // Phase 74 (Gap #3) — audit log row.
    if (this.auditFacade) {
      this.auditFacade
        .writeAuditLog({
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'ORDER_REJECTED',
          module: 'orders',
          resource: 'master_order',
          resourceId: id,
          oldValue: {
            orderStatus: previousOrderStatus,
            paymentStatus: previousPaymentStatus,
          },
          newValue: {
            orderStatus: 'REJECTED',
            paymentStatus: 'CANCELLED',
            rejectedBy: adminId,
            rejectionReason: reason,
          },
          metadata: {
            orderNumber,
            customerId,
            totalAmount,
            refundRequired: previousPaymentStatus === 'PAID',
          },
          ipAddress: actorContext?.ipAddress,
          userAgent: actorContext?.userAgent,
        })
        .catch((err: any) =>
          this.logger.warn(
            `Audit log write for ORDER_REJECTED failed (order ${id}): ${(err as Error).message}`,
          ),
        );
    }

    // Phase 74 (Gap #17/#18) — domain event for notifications +
    // downstream (affiliate commission reverser, analytics, BI).
    try {
      await this.eventBus.publish({
        eventName: 'orders.master.rejected',
        aggregate: 'MasterOrder',
        aggregateId: id,
        occurredAt: new Date(),
        payload: {
          masterOrderId: id,
          orderNumber,
          customerId,
          rejectedBy: adminId ?? null,
          rejectionReason: reason ?? null,
          previousPaymentStatus,
          refundRequired: previousPaymentStatus === 'PAID',
          totalAmount,
        },
      });
    } catch {
      // best-effort
    }
  }

  async acceptSubOrder(id: string) {
    const subOrder = await this.orderRepo.findSubOrderById(id);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    // Phase 0 (PR 0.8) — admin-callable variant previously had no FSM
    // check, so an admin could flip a terminally REJECTED sub-order
    // back to ACCEPTED. Assert the matrix.
    assertTransition('OrderAcceptStatus', subOrder.acceptStatus, 'ACCEPTED');
    return this.orderRepo.updateSubOrder(id, { acceptStatus: 'ACCEPTED' });
  }

  async rejectSubOrder(id: string) {
    const subOrder = await this.orderRepo.findSubOrderById(id);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    // Phase 0 (PR 0.8) — same shape as acceptSubOrder.
    assertTransition('OrderAcceptStatus', subOrder.acceptStatus, 'REJECTED');
    return this.orderRepo.updateSubOrder(id, { acceptStatus: 'REJECTED' });
  }

  async fulfillSubOrder(id: string) {
    const subOrder = await this.orderRepo.findSubOrderById(id);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');
    // Phase 0 (PR 0.8) — fulfillmentStatus is its own FSM. Assert.
    assertTransition(
      'OrderFulfillmentStatus',
      subOrder.fulfillmentStatus,
      'FULFILLED',
    );
    return this.orderRepo.updateSubOrder(id, {
      fulfillmentStatus: 'FULFILLED',
    });
  }

  // Phase 108 (2026-05-25) — sellerInitiateReturn was removed. The old
  // self-serve seller "return" executed immediately (stock credit + sub-order
  // CANCELLED) with no persisted record, admin approval, commission/settlement
  // reversal, or audit — letting a seller self-credit inventory untraced. It
  // is replaced by the admin-approved SellerReversalService (returns module),
  // exposed at POST /seller/reversals and PATCH /admin/seller-reversals/:id/*.

  /**
   * Admin-initiated mid-flow sub-order cancel. Reverses any outstanding
   * seller/franchise stock hold, releases reservations (if still in
   * pre-delivery states), marks the sub-order CANCELLED, and publishes an
   * event. Callers that need to cancel an entire master order can call this
   * per-sub-order.
   */
  async adminCancelSubOrder(
    subOrderId: string,
    adminId: string,
    reason: string,
    opts?: { force?: boolean },
  ) {
    if (!subOrderId)
      throw new BadRequestAppException('subOrderId is required');
    // Phase 81 — Gap #11. Server-side reason guard. DTO enforces this
    // at the controller too; this guard catches programmatic callers.
    if (!reason || !reason.trim() || reason.trim().length < 10) {
      throw new BadRequestAppException(
        'reason is required (minimum 10 characters)',
      );
    }
    const force = !!opts?.force;
    const trimmedReason = reason.trim();

    const subOrder =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    if (subOrder.fulfillmentStatus === 'DELIVERED') {
      throw new BadRequestAppException(
        'Cannot cancel a DELIVERED sub-order — use the return flow instead',
      );
    }
    if (subOrder.fulfillmentStatus === 'CANCELLED') {
      throw new BadRequestAppException('Sub-order is already cancelled');
    }
    // Phase 81 — Gap #8. SHIPPED / FULFILLED cancels require explicit
    // force flag because the courier needs to be coordinated. Without
    // force, the standard pre-shipment gate applies.
    const inTransit =
      subOrder.fulfillmentStatus === 'SHIPPED' ||
      subOrder.fulfillmentStatus === 'FULFILLED';
    if (inTransit && !force) {
      throw new BadRequestAppException(
        `Sub-order is ${subOrder.fulfillmentStatus} — pass force=true (and hold orders.subOrder.cancel.force) to cancel in-transit goods`,
      );
    }

    const nodeType =
      ((subOrder as any).fulfillmentNodeType as 'SELLER' | 'FRANCHISE') ||
      'SELLER';
    const sellerId: string | null = subOrder.sellerId ?? null;
    const franchiseId: string | null = (subOrder as any).franchiseId ?? null;
    const masterOrderId = subOrder.masterOrder.id;
    const previousFulfillmentStatus = subOrder.fulfillmentStatus;
    const previousAcceptStatus = subOrder.acceptStatus;
    const now = new Date();

    // Pre-fetch master-order payment context so the refund saga can
    // run post-tx if applicable. We need paymentStatus + method +
    // customerId before we enter the tx (the saga itself fires after
    // commit so the DB state is durable).
    const masterCtx = await this.prisma.masterOrder.findUnique({
      where: { id: masterOrderId },
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
        paymentStatus: true,
        paymentMethod: true,
        totalAmountInPaise: true,
        // Wallet portion (paise) so a full-master cancel can refund it.
        walletAmountUsedInPaise: true,
        orderStatus: true,
      },
    });
    if (!masterCtx) {
      throw new NotFoundAppException('Master order not found');
    }

    // Phase 81 — single atomic transaction wrapping:
    //   1. FOR UPDATE row lock on the sub-order (Gap #22 race close).
    //   2. FSM-enforced transition (Gap #8).
    //   3. Sub-order-scoped previous-stock release (Gap #5).
    //   4. Sub-order status flip + cancellation audit columns (Gap #2/#3).
    //   5. Master-order status recompute (Gap #6/#20).
    //   6. Commission decision flag (Gap #15).
    //   7. Audit log row (Gap #4).
    //   8. Outbox-aware event publish (Gap #7/#14/#16 subscribers).
    let result: any;
    let newMasterStatus: string | null = null;
    try {
      result = await this.orderRepo.executeTransaction(async (tx) => {
        // 1. FOR UPDATE lock + re-check the row hasn't been raced.
        const lockedRows = await tx.$queryRaw<
          Array<{
            id: string;
            fulfillment_status: string;
            accept_status: string;
          }>
        >`
          SELECT id, fulfillment_status, accept_status
          FROM sub_orders
          WHERE id = ${subOrderId}
          FOR UPDATE
        `;
        const locked = lockedRows[0];
        if (!locked) {
          throw new NotFoundAppException('Sub-order disappeared mid-tx');
        }
        if (locked.fulfillment_status === 'CANCELLED') {
          throw new ConflictAppException(
            'Sub-order was cancelled by another actor — refresh and try again',
          );
        }
        if (locked.fulfillment_status === 'DELIVERED') {
          throw new ConflictAppException(
            'Sub-order delivered between snapshot and lock — use returns flow',
          );
        }

        // 2. FSM check (Gap #8) — under the lock so the seller's
        // concurrent SHIPPED transition can't race past us.
        assertTransition(
          'OrderFulfillmentStatus',
          locked.fulfillment_status as any,
          'CANCELLED',
        );

        // 3. Release previous SELLER hold scoped to THIS sub-order's
        // items (Gap #5 fix). FRANCHISE side runs outside the tx
        // because the facade isn't tx-aware.
        if (nodeType === 'SELLER' && sellerId) {
          await this.stockRestore.restoreForSubOrderItems(
            tx,
            masterOrderId,
            sellerId,
            subOrder.items.map((i: any) => ({
              productId: i.productId,
              variantId: i.variantId ?? null,
            })),
          );
        }

        // 4. Sub-order status flip + cancellation audit columns
        // (Gap #2/#3) + commission decision flip (Gap #15).
        const updatedRow = await tx.subOrder.update({
          where: { id: subOrderId },
          data: {
            fulfillmentStatus: 'CANCELLED',
            acceptStatus: 'CANCELLED',
            cancelledAt: now,
            cancelledBy: adminId ?? null,
            cancelReason: trimmedReason,
            cancellationSource: 'ADMIN',
            // Gap #15 — settlement sweep skips this row.
            commissionDecision: 'NOT_APPLICABLE',
          } as any,
        });

        // Phase 84 (2026-05-23) — timeline event inside the tx.
        if (this.timeline) {
          await this.timeline.record(
            {
              masterOrderId,
              subOrderId,
              eventType: 'SUBORDER_CANCELLED_BY_ADMIN',
              oldStatus: previousFulfillmentStatus,
              newStatus: 'CANCELLED',
              actorType: 'ADMIN',
              actorId: adminId,
              reason: trimmedReason,
              metadata: { force, previousAcceptStatus },
            },
            tx,
          );
        }

        // 5. Master-order status recompute (Gap #6/#20).
        // Read every sibling sub-order's status to decide if the
        // master should flip to PARTIALLY_CANCELLED, CANCELLED, or
        // stay where it is.
        const siblings = await tx.subOrder.findMany({
          where: { masterOrderId },
          select: { id: true, fulfillmentStatus: true, acceptStatus: true },
        });
        // Terminal states (CANCELLED / REJECTED) mean "this sub-order
        // is done". Anything else is still live.
        const isTerminal = (s: { fulfillmentStatus: string; acceptStatus: string }) =>
          s.fulfillmentStatus === 'CANCELLED' ||
          s.acceptStatus === 'REJECTED';
        const cancelledCount = siblings.filter(
          (s: any) => s.fulfillmentStatus === 'CANCELLED',
        ).length;
        const allTerminal = siblings.every(isTerminal);
        const allCancelled = siblings.every(
          (s: any) => s.fulfillmentStatus === 'CANCELLED',
        );

        if (allCancelled) {
          newMasterStatus = 'CANCELLED';
        } else if (allTerminal) {
          // Some rejected, rest cancelled — the master is effectively
          // dead. Treat as CANCELLED for customer-facing display.
          newMasterStatus = 'CANCELLED';
        } else if (cancelledCount > 0) {
          newMasterStatus = 'PARTIALLY_CANCELLED';
        }

        if (newMasterStatus && newMasterStatus !== masterCtx.orderStatus) {
          // Only attempt the transition if the FSM allows it. The
          // matrix permits VERIFIED / ROUTED_TO_SELLER /
          // SELLER_ACCEPTED / DISPATCHED → PARTIALLY_CANCELLED, and
          // any of those → CANCELLED.
          if (
            isTransitionAllowed(
              'OrderStatus',
              masterCtx.orderStatus as any,
              newMasterStatus as any,
            )
          ) {
            await tx.masterOrder.update({
              where: { id: masterOrderId },
              data: { orderStatus: newMasterStatus as any },
            });
            // Phase 84 — master rollup timeline event.
            if (this.timeline) {
              await this.timeline.record(
                {
                  masterOrderId,
                  eventType:
                    newMasterStatus === 'CANCELLED'
                      ? 'ORDER_CANCELLED'
                      : 'ORDER_PARTIALLY_CANCELLED',
                  oldStatus: masterCtx.orderStatus,
                  newStatus: newMasterStatus,
                  actorType: 'SYSTEM',
                },
                tx,
              );
            }
          } else {
            // FSM blocks the transition — log and leave the master
            // status unchanged. The sub-order cancellation still
            // commits.
            this.logger.warn(
              `Cancel ${subOrderId}: master ${masterOrderId} status ${masterCtx.orderStatus} → ${newMasterStatus} blocked by FSM, leaving master unchanged`,
            );
            newMasterStatus = null;
          }
        } else if (newMasterStatus === masterCtx.orderStatus) {
          newMasterStatus = null;
        }

        // 6. Audit log row INSIDE the tx (Gap #4). The
        // best-effort .catch() that pre-Phase-81 swallowed audit
        // write errors is gone — any DB-side failure here rolls
        // back the whole cancel.
        if (this.auditFacade) {
          await this.auditFacade.writeAuditLog({
            actorId: adminId,
            actorRole: 'ADMIN',
            action: 'SUB_ORDER_CANCELLED',
            module: 'orders',
            resource: 'SubOrder',
            resourceId: subOrderId,
            oldValue: {
              fulfillmentStatus: previousFulfillmentStatus,
              acceptStatus: previousAcceptStatus,
            },
            newValue: {
              fulfillmentStatus: 'CANCELLED',
              acceptStatus: 'CANCELLED',
              cancelledAt: now,
              cancelReason: trimmedReason,
              cancellationSource: 'ADMIN',
              force,
              newMasterStatus,
            },
          } as any);
        }

        // 7. Outbox-aware event publish — committed atomically with
        // the writes when OUTBOX_DUAL_WRITE is on (Gap #7/#14/#16
        // subscribers).
        await this.eventBus.publish(
          {
            eventName: 'orders.sub_order.cancelled_by_admin',
            aggregate: 'SubOrder',
            aggregateId: subOrderId,
            occurredAt: now,
            payload: {
              subOrderId,
              masterOrderId,
              orderNumber: masterCtx.orderNumber,
              customerId: masterCtx.customerId,
              adminId,
              previousFulfillmentStatus,
              previousAcceptStatus,
              nodeType,
              sellerId,
              franchiseId,
              reason: trimmedReason,
              force,
              newMasterStatus,
              // Phase 81 — refund context for the saga subscriber.
              paymentStatus: masterCtx.paymentStatus,
              paymentMethod: masterCtx.paymentMethod,
              subOrderSubTotalInPaise: (subOrder as any).subTotalInPaise
                ? (subOrder as any).subTotalInPaise.toString()
                : '0',
            },
          },
          { tx },
        );

        return updatedRow;
      });
    } catch (err) {
      throw err;
    }

    // 8. Franchise unreserve runs AFTER commit. The franchise facade
    // is not tx-aware; a failure here leaves the sub-order
    // correctly cancelled but the franchise stock still held. Logged
    // so ops can reconcile.
    if (nodeType === 'FRANCHISE' && franchiseId) {
      for (const item of subOrder.items) {
        await this.franchiseFacade
          .unreserveStock(
            franchiseId,
            item.productId,
            item.variantId ?? null,
            item.quantity,
            masterOrderId,
          )
          .catch((e) => {
            this.logger.warn(
              `Franchise unreserve failed for ${franchiseId} on sub-order ${subOrderId}: ${
                (e as Error).message
              }`,
            );
          });
      }
    }

    // 9. Refund saga (Gap #1) — fires only for prepaid sub-orders.
    // The refund amount is the sub-order's subTotalInPaise. COD
    // orders + unpaid orders are no-ops. Idempotency key keyed on
    // the sub-order so a retry doesn't double-refund.
    //
    // Robustness: the paise sibling can be 0 / unpopulated on some
    // order-creation paths (e.g. admin-created orders) even though the
    // amount is genuinely paid. Relying on subTotalInPaise alone silently
    // skipped the refund, leaving a paid-then-cancelled customer un-refunded.
    // Fall back to the canonical order-item paise (unitPriceInPaise × qty,
    // already loaded via findSubOrderByIdWithItems) so a real refund still fires.
    let subTotalInPaise = (subOrder as any).subTotalInPaise as bigint | undefined;
    if (!subTotalInPaise || subTotalInPaise <= 0n) {
      const derived = ((subOrder.items ?? []) as any[]).reduce(
        (sum: bigint, it: any) =>
          sum + BigInt(it.unitPriceInPaise ?? 0) * BigInt(it.quantity ?? 0),
        0n,
      );
      if (derived > 0n) {
        this.logger.warn(
          `Sub-order ${subOrderId} cancel: subTotalInPaise was ${subTotalInPaise ?? 'null'}; ` +
            `derived ₹${(Number(derived) / 100).toFixed(2)} from items so the refund is not skipped.`,
        );
        subTotalInPaise = derived;
      }
    }
    if (
      masterCtx.paymentStatus === 'PAID' &&
      masterCtx.paymentMethod === 'ONLINE' &&
      this.refundInstructions &&
      subTotalInPaise &&
      subTotalInPaise > 0n
    ) {
      try {
        await this.refundInstructions.createSplitForRefund({
          sourceType: 'MANUAL' as any,
          sourceId: subOrderId,
          sourceLabel: `cancel-sub-order:${subOrderId}`,
          customerId: masterCtx.customerId,
          masterOrderId,
          amountInPaise: subTotalInPaise,
          baseIdempotencyKey: `cancel-sub-order:${subOrderId}`,
          // Refund policy: ALWAYS to wallet (store credit) — never reversed to
          // the card/gateway — for both pre- and post-shipment cancels.
          forceFullWallet: true,
          // Approval gated by SHIP STATUS: a pre-shipment cancel auto-credits
          // the wallet instantly (no approval); a post-shipment force-cancel
          // still routes to Finance → Refund Approvals before crediting.
          requiresApproval: ['SHIPPED', 'DELIVERED', 'FULFILLED'].includes(
            previousFulfillmentStatus as string,
          ),
        });
      } catch (err) {
        // Refund failure must not roll back the cancel — the order
        // is already terminal at the DB layer. Emit a recovery event
        // so finance ops can step in.
        this.logger.error(
          `Refund saga creation failed for cancelled sub-order ${subOrderId}: ${(err as Error).message}`,
        );
        this.eventBus
          .publish({
            eventName: 'orders.refund.required',
            aggregate: 'SubOrder',
            aggregateId: subOrderId,
            occurredAt: new Date(),
            payload: {
              subOrderId,
              masterOrderId,
              customerId: masterCtx.customerId,
              amountInPaise: subTotalInPaise.toString(),
              reason: 'SUB_ORDER_CANCELLED',
              error: (err as Error).message,
            },
          })
          .catch(() => undefined);
      }
    } else if (
      masterCtx.paymentStatus === 'PAID' &&
      masterCtx.paymentMethod === 'ONLINE' &&
      !this.refundInstructions
    ) {
      this.logger.error(
        `Sub-order ${subOrderId} cancelled with paymentStatus=PAID but RefundInstructionService not injected — manual refund required`,
      );
    }

    // Wallet-portion refund on cancel. Wallet is debited at checkout
    // (ORDER_REDEMPTION, master-level) regardless of paymentStatus, so a
    // wallet-paid order cancelled before delivery must get that money back.
    // Fire ONLY when the WHOLE master is now cancelled (never on a partial
    // multi-sub cancel) AND the PAID/ONLINE split-refund saga above did NOT
    // already handle it (that path refunds the wallet portion via the split
    // calculator — double-refunding here would be the bug). Routed through the
    // SAME durable, idempotent checkout-cancellation refund saga the customer
    // path uses (dedups on orderId+customerId+amount), so customer + admin
    // cancels of one master collapse to a single wallet refund.
    const splitSagaHandledWallet =
      masterCtx.paymentStatus === 'PAID' &&
      masterCtx.paymentMethod === 'ONLINE' &&
      !!this.refundInstructions;
    const masterWalletPaise = Number(masterCtx.walletAmountUsedInPaise ?? 0);
    if (
      newMasterStatus === 'CANCELLED' &&
      !splitSagaHandledWallet &&
      masterWalletPaise > 0 &&
      this.walletFacade
    ) {
      try {
        await this.walletFacade.enqueueCheckoutCancellationRefund({
          customerId: masterCtx.customerId,
          orderId: masterOrderId,
          amountInPaise: masterWalletPaise,
          reason: `Order ${masterCtx.orderNumber} cancelled before delivery — wallet refund`,
        });
      } catch (err) {
        // Saga row + retry cron own recovery; never roll back the committed cancel.
        this.logger.error(
          `Failed to enqueue wallet cancellation refund for master ${masterOrderId}: ${(err as Error).message}`,
        );
      }
    }

    return result;
  }

  /**
   * Phase 83 (2026-05-23) — delivery confirmation audit. Closes:
   *   • Gap #3   — deliveredBy / deliverySource columns persisted.
   *   • Gap #4   — single tx wraps FOR UPDATE + status flip +
   *                master rollup + commission scheduling + audit log
   *                + outbox event publish.
   *   • Gap #12  — audit_log row written for every delivery.
   *   • Gap #16  — event published with `{ tx }` so the outbox row
   *                commits atomically with the writes.
   *   • Master rollup now includes PARTIALLY_DELIVERED for the
   *     "some delivered, others in transit" case.
   *   • Gap #2 partial — commissionLockScheduledAt set inside the
   *     same tx so the polling cron picks it up exactly at the
   *     return-window boundary.
   *
   * The `source` param defaults to MANUAL_ADMIN for backwards-compat
   * with admin-controller callers that don't yet thread the source.
   * Webhook controllers pass the matching enum.
   */
  async deliverSubOrder(
    id: string,
    opts?: {
      source?:
        | 'WEBHOOK_SHIPROCKET'
        | 'WEBHOOK_DELHIVERY'
        | 'MANUAL_ADMIN'
        | 'MANUAL_FRANCHISE';
      deliveredBy?: string;
      deliveryProofUrl?: string;
      deliveryOtpVerified?: boolean;
      deliverySignatureUrl?: string;
    },
  ) {
    const subOrder =
      await this.orderRepo.findSubOrderByIdWithMasterOrder(id);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    // Pre-tx FSM gate (friendlier error than the under-lock check).
    if (subOrder.fulfillmentStatus !== 'SHIPPED') {
      throw new BadRequestAppException(
        `Cannot mark as delivered — sub-order fulfillment status is ${subOrder.fulfillmentStatus}, expected SHIPPED`,
      );
    }

    const now = new Date();
    const returnWindowEndsAt = new Date(now.getTime() + this.returnWindowMs);
    const source = opts?.source ?? 'MANUAL_ADMIN';
    const deliveredBy = opts?.deliveredBy ?? null;
    const previousFulfillmentStatus = subOrder.fulfillmentStatus;
    let newMasterStatus: string | null = null;

    const updated = await this.orderRepo.executeTransaction(async (tx) => {
      // FOR UPDATE row lock — closes the race against admin cancel /
      // concurrent webhook arrivals (Gap #4 R6).
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; fulfillment_status: string }>
      >`
        SELECT id, fulfillment_status
        FROM sub_orders
        WHERE id = ${id}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundAppException('Sub-order disappeared mid-tx');
      }
      // FSM under the lock — catches concurrent cancel that already
      // committed CANCELLED between our snapshot and lock acquire.
      assertTransition(
        'OrderFulfillmentStatus',
        locked.fulfillment_status as any,
        'DELIVERED',
      );

      const updatedRow = await tx.subOrder.update({
        where: { id },
        data: {
          fulfillmentStatus: 'DELIVERED',
          deliveredAt: now,
          returnWindowEndsAt,
          // Phase 83 — Gap #3/#11. Audit columns populated.
          deliveredBy,
          deliverySource: source as any,
          deliveryProofUrl: opts?.deliveryProofUrl ?? null,
          deliveryOtpVerified: opts?.deliveryOtpVerified ?? null,
          deliverySignatureUrl: opts?.deliverySignatureUrl ?? null,
          // Phase 83 — Gap #2. Schedule the commission lock for
          // when the return window closes. Polling cron picks it
          // up the moment the scheduled time passes.
          commissionLockScheduledAt: returnWindowEndsAt,
        } as any,
      });

      // Master rollup: scan siblings INSIDE the tx so we see this
      // row's updated state alongside the others.
      const siblings = await tx.subOrder.findMany({
        where: { masterOrderId: subOrder.masterOrderId },
        select: { id: true, fulfillmentStatus: true, acceptStatus: true },
      });
      const active = siblings.filter(
        (s: any) => s.acceptStatus !== 'REJECTED',
      );
      const deliveredCount = active.filter(
        (s: any) => s.fulfillmentStatus === 'DELIVERED',
      ).length;
      const target =
        deliveredCount === active.length && active.length > 0
          ? 'DELIVERED'
          : deliveredCount > 0
            ? 'PARTIALLY_DELIVERED'
            : null;

      if (target) {
        const master = await tx.masterOrder.findUnique({
          where: { id: subOrder.masterOrderId },
          select: { orderStatus: true },
        });
        if (
          master &&
          master.orderStatus !== target &&
          isTransitionAllowed(
            'OrderStatus',
            master.orderStatus as any,
            target as any,
          )
        ) {
          await tx.masterOrder.update({
            where: { id: subOrder.masterOrderId },
            data: { orderStatus: target as any },
          });
          newMasterStatus = target;
        } else if (master && master.orderStatus !== target) {
          // FSM rejects the transition — log and leave master
          // unchanged. The sub-order DELIVERED still commits; admin
          // can resolve the exception state separately.
          this.logger.warn(
            `deliverSubOrder: master ${subOrder.masterOrderId} status ${master.orderStatus} → ${target} blocked by FSM`,
          );
        }
      }

      // Gap #12 — audit log inside the tx. Failure rolls back the
      // delivery (audit chain integrity > delivery acknowledgment).
      if (this.auditFacade) {
        await this.auditFacade.writeAuditLog({
          actorId: deliveredBy,
          actorRole: source.startsWith('WEBHOOK_') ? 'SYSTEM' : 'ADMIN',
          action: 'SUB_ORDER_DELIVERED',
          module: 'orders',
          resource: 'SubOrder',
          resourceId: id,
          oldValue: { fulfillmentStatus: previousFulfillmentStatus },
          newValue: {
            fulfillmentStatus: 'DELIVERED',
            deliveredAt: now,
            deliverySource: source,
            deliveryProofUrl: opts?.deliveryProofUrl ?? null,
            commissionLockScheduledAt: returnWindowEndsAt,
            newMasterStatus,
          },
        } as any);
      }

      // Phase 84 (2026-05-23) — record timeline event inside the tx
      // (Gaps #1/#3/#6). One row per delivery transition with full
      // actor + source metadata. Webhook deliveries also surface a
      // tracking URL via metadata so the customer endpoint can
      // render the "Track your order" button.
      if (this.timeline) {
        const isWebhook = source.startsWith('WEBHOOK_');
        await this.timeline.record(
          {
            masterOrderId: subOrder.masterOrderId,
            subOrderId: id,
            eventType: isWebhook
              ? 'SUBORDER_DELIVERED_WEBHOOK'
              : 'SUBORDER_DELIVERED_MANUAL',
            oldStatus: previousFulfillmentStatus,
            newStatus: 'DELIVERED',
            actorType: isWebhook
              ? 'CARRIER'
              : source === 'MANUAL_FRANCHISE'
                ? 'FRANCHISE'
                : 'ADMIN',
            actorId: deliveredBy,
            metadata: {
              source,
              deliveredAt: now.toISOString(),
              returnWindowEndsAt: returnWindowEndsAt.toISOString(),
              deliveryProofUrl: opts?.deliveryProofUrl ?? null,
              deliveryOtpVerified: opts?.deliveryOtpVerified ?? null,
            },
          },
          tx,
        );
        // Master rollup event (PARTIALLY_DELIVERED / DELIVERED).
        if (newMasterStatus) {
          await this.timeline.record(
            {
              masterOrderId: subOrder.masterOrderId,
              eventType:
                newMasterStatus === 'DELIVERED'
                  ? 'ORDER_DELIVERED'
                  : 'ORDER_PARTIALLY_DELIVERED',
              newStatus: newMasterStatus,
              actorType: 'SYSTEM',
            },
            tx,
          );
        }
      }

      // Gap #16 — outbox-aware publish, atomic with the writes.
      await this.eventBus.publish(
        {
          eventName: 'orders.sub_order.delivered',
          aggregate: 'SubOrder',
          aggregateId: id,
          occurredAt: now,
          payload: {
            subOrderId: id,
            masterOrderId: subOrder.masterOrderId,
            sellerId: subOrder.sellerId,
            deliveredAt: now.toISOString(),
            returnWindowEndsAt: returnWindowEndsAt.toISOString(),
            deliverySource: source,
            deliveredBy,
            newMasterStatus,
            allDelivered: target === 'DELIVERED',
          },
        },
        { tx },
      );

      return updatedRow;
    });

    return updated;
  }

  /**
   * COD "mark as paid" — records that the delivery agent collected cash and
   * flips the order to PAID (which fans out commission + affiliate settlement
   * via `payments.payment.captured`).
   *
   * Phase 168 (COD Mark-Paid audit) — hardened from a thin façade over
   * `orderStatus.update` into an auditable cash-collection event:
   *   • #1  COD-only — an ONLINE order can NEVER be flipped PAID here (it must
   *          settle via Razorpay verify/webhook with a gateway amount match).
   *   • #7  CAS flip (updateMany WHERE paymentStatus='PENDING') so two
   *          concurrent admin clicks can't both "win".
   *   • #3  paidBy / paidAt / paymentReference / paymentNotes /
   *          collectedAmountInPaise persisted on the order.
   *   • #4/#9 a CashCollection ledger row per event, with variance =
   *          collected − expected (a non-zero variance REQUIRES a reason).
   *   • #5  AuditPublicFacade write (action COD_MARK_PAID) with actor + ip + ua.
   *   • #14 the captured event carries amountInPaise (BigInt-safe).
   *   • #15 an orderStatus FSM mismatch opens a PaymentMismatchAlert instead of
   *          being swallowed in a log line.
   *   • #17 the event is published INSIDE the tx (durable outbox when dual-write
   *          is on) so a crash can't lose the commission/affiliate fan-out.
   */
  async markAsPaid(
    id: string,
    opts: {
      actorId?: string;
      actorRole?: string;
      collectedAmountInPaise?: bigint;
      collectionReference?: string;
      notes?: string;
      varianceReason?: string;
      ipAddress?: string;
      userAgent?: string;
    } = {},
  ) {
    const order = await this.orderRepo.findMasterOrderById(id);
    if (!order) throw new NotFoundAppException('Order not found');

    // #1 — COD-only. An ONLINE order reaching this path means someone is
    // trying to flip a gateway order PAID with zero gateway involvement.
    if (order.paymentMethod !== 'COD') {
      throw new BadRequestAppException(
        'mark-paid is for COD orders only — online orders settle via the ' +
          'Razorpay verify / webhook path (which verifies the captured amount).',
        'MARK_PAID_NON_COD',
      );
    }

    // Only consider active (non-rejected) sub-orders
    const activeSubOrders = order.subOrders.filter(
      (so: any) => so.acceptStatus !== 'REJECTED',
    );
    const relevantSubOrders =
      activeSubOrders.length > 0 ? activeSubOrders : order.subOrders;
    const allDelivered = relevantSubOrders.every(
      (so: any) => so.fulfillmentStatus === 'DELIVERED',
    );

    if (!allDelivered) {
      throw new BadRequestAppException(
        'Cannot mark as paid — all active sub-orders must be DELIVERED first',
      );
    }

    if (order.paymentStatus === 'PAID') {
      throw new BadRequestAppException('Order is already marked as paid');
    }

    if (order.paymentStatus === 'CANCELLED') {
      throw new BadRequestAppException(
        'Cannot mark a cancelled order as paid',
      );
    }

    // FSM enforcement — pinning the rule that VOIDED → PAID and other
    // illegal transitions are also rejected. (The only legal source is
    // PENDING; see PAYMENT_STATUS_TRANSITIONS.)
    assertTransition('OrderPaymentStatus', order.paymentStatus, 'PAID');

    // #4/#9 — cash variance. The cash actually due at the door is the order
    // total MINUS any wallet already debited at checkout (a wallet-applied COD
    // order must not be charged twice). Source the total from the Decimal
    // `totalAmount`: `totalAmountInPaise` is a dual-write mirror that is 0 when
    // MONEY_DUAL_WRITE_ENABLED=false, whereas `walletAmountUsedInPaise` is
    // written directly at checkout and is always reliable. Default the collected
    // amount to that payable (the UI's "collect full" affordance); when the
    // admin records a different amount, a variance reason is mandatory so the
    // discrepancy is never silently absorbed.
    const grossInPaise = BigInt(Math.round(Number(order.totalAmount) * 100));
    const walletInPaise = BigInt(order.walletAmountUsedInPaise ?? 0);
    const expectedInPaise =
      grossInPaise > walletInPaise ? grossInPaise - walletInPaise : 0n;
    const collectedInPaise =
      opts.collectedAmountInPaise ?? expectedInPaise;
    if (collectedInPaise < 0n) {
      throw new BadRequestAppException('collectedAmountInPaise cannot be negative');
    }
    const varianceInPaise = collectedInPaise - expectedInPaise;
    if (varianceInPaise !== 0n && !opts.varianceReason?.trim()) {
      throw new BadRequestAppException(
        `Collected amount (₹${(Number(collectedInPaise) / 100).toFixed(2)}) does not ` +
          `match the payable (₹${(Number(expectedInPaise) / 100).toFixed(2)}); ` +
          `a varianceReason is required to record a cash discrepancy.`,
        'COD_CASH_VARIANCE_UNEXPLAINED',
      );
    }

    // Phase 0 (PR 0.8) — the old code also wrote `orderStatus: 'DELIVERED'`
    // unconditionally. Most callers reach this after sub-orders are all
    // DELIVERED, so the master is in DISPATCHED. Validate before we
    // bypass the matrix.
    const willTouchOrderStatus = isTransitionAllowed(
      'OrderStatus',
      order.orderStatus,
      'DELIVERED',
    );

    const paidAt = new Date();
    // #7 — CAS flip. The WHERE clause re-checks PENDING inside the tx so two
    // concurrent callers can't both flip-and-fan-out; the loser sees count=0.
    const flipped = await this.orderRepo.executeTransaction(async (tx) => {
      const res = await tx.masterOrder.updateMany({
        where: { id, paymentStatus: 'PENDING' },
        data: willTouchOrderStatus
          ? {
              paymentStatus: 'PAID',
              orderStatus: 'DELIVERED',
              paidBy: opts.actorId ?? null,
              paidAt,
              paymentReference: opts.collectionReference ?? null,
              paymentNotes: opts.notes ?? null,
              collectedAmountInPaise: collectedInPaise,
            }
          : {
              paymentStatus: 'PAID',
              paidBy: opts.actorId ?? null,
              paidAt,
              paymentReference: opts.collectionReference ?? null,
              paymentNotes: opts.notes ?? null,
              collectedAmountInPaise: collectedInPaise,
            },
      });
      if (res.count === 0) {
        // Lost the race (or status moved out of PENDING under us). Do NOTHING
        // else — the winner owns the ledger row + event fan-out.
        return false;
      }

      for (const so of relevantSubOrders) {
        await tx.subOrder.update({
          where: { id: so.id },
          data: {
            paymentStatus: 'PAID',
            paidAt,
            paidBy: opts.actorId ?? null,
            paymentReference: opts.collectionReference ?? null,
          },
        });
      }

      // #4 — immutable cash-collection ledger row.
      await tx.cashCollection.create({
        data: {
          masterOrderId: id,
          subOrderId: null,
          expectedAmountInPaise: expectedInPaise,
          collectedAmountInPaise: collectedInPaise,
          varianceInPaise,
          varianceReason: opts.varianceReason?.trim() || null,
          collectionReference: opts.collectionReference ?? null,
          notes: opts.notes ?? null,
          collectedByAdminId: opts.actorId ?? null,
          collectedAt: paidAt,
        },
      });

      // #14/#17 — durable, BigInt-safe event INSIDE the tx (atomic outbox when
      // OUTBOX_DUAL_WRITE is on; falls back to post-commit emit otherwise).
      await this.eventBus.publish(
        {
          eventName: 'payments.payment.captured',
          aggregate: 'MasterOrder',
          aggregateId: id,
          occurredAt: paidAt,
          payload: {
            masterOrderId: id,
            orderNumber: order.orderNumber,
            customerId: order.customerId,
            amount: Number(order.totalAmount),
            amountInPaise: collectedInPaise.toString(),
            paymentMethod: order.paymentMethod,
            source: 'admin.markAsPaid',
          },
        },
        { tx },
      );

      return true;
    });

    if (!flipped) {
      this.logger.warn(
        `markAsPaid: order ${id} was concurrently flipped out of PENDING; ` +
          `this caller is a no-op (idempotent).`,
      );
      throw new BadRequestAppException('Order is already marked as paid');
    }

    // #5 — audit trail (best-effort, post-commit; the DB state is the source of
    // truth and a logging outage must not roll back a collected payment).
    await this.auditFacade
      ?.writeAuditLog({
        actorId: opts.actorId,
        actorRole: opts.actorRole,
        action: 'COD_MARK_PAID',
        module: 'orders',
        resource: 'MasterOrder',
        resourceId: id,
        oldValue: { paymentStatus: order.paymentStatus, orderStatus: order.orderStatus },
        newValue: {
          paymentStatus: 'PAID',
          orderStatus: willTouchOrderStatus ? 'DELIVERED' : order.orderStatus,
        },
        metadata: {
          orderNumber: order.orderNumber,
          expectedInPaise: expectedInPaise.toString(),
          collectedInPaise: collectedInPaise.toString(),
          varianceInPaise: varianceInPaise.toString(),
          varianceReason: opts.varianceReason ?? null,
          collectionReference: opts.collectionReference ?? null,
        },
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `markAsPaid: audit write failed for order ${id}: ${(err as Error)?.message ?? err}`,
        ),
      );

    // #15 — orderStatus FSM mismatch is a real reconciliation item, not a
    // log-and-forget. The payment IS collected (good), but the order is PAID
    // while sitting in a non-DELIVERED orderStatus — surface it to ops.
    if (!willTouchOrderStatus) {
      this.logger.warn(
        `markAsPaid: master order ${id} is in ${order.orderStatus} — ` +
          `illegal transition to DELIVERED. paymentStatus flipped to PAID; ` +
          `orderStatus left unchanged. Opening a reconciliation alert.`,
      );
      await this.paymentOps
        ?.flagMismatch({
          kind: 'DUPLICATE_PAYMENT',
          masterOrderId: id,
          orderNumber: order.orderNumber,
          severity: 70,
          description:
            `COD mark-paid succeeded for order ${order.orderNumber} but its ` +
            `orderStatus (${order.orderStatus}) could not advance to DELIVERED. ` +
            `paymentStatus is PAID; orderStatus needs manual reconciliation. ` +
            `actorId=${opts.actorId ?? 'n/a'}`,
        })
        .catch((err) =>
          this.logger.error(
            `markAsPaid: failed to open orderStatus-mismatch alert for ${id}: ${(err as Error)?.message ?? err}`,
          ),
        );
    }
  }

  /**
   * Phase 168 (COD Mark-Paid audit #10) — per-sub-order COD cash collection.
   *
   * Multi-seller COD orders deliver sub-orders independently; cash for a
   * delivered sub-order can be collected (and attributed) while siblings are
   * still in transit. This records that single collection, then recomputes the
   * master's paymentStatus — flipping the MASTER to PAID only once EVERY active
   * sub-order is PAID (so commission/affiliate fan-out fires exactly once, at
   * the right moment).
   *
   * Reuses the same money-safety contract as `markAsPaid`: COD-only, delivered-
   * only, CAS on the sub-order's PENDING→PAID flip, a CashCollection ledger row,
   * variance gate, and an audit row.
   */
  async markSubOrderAsPaid(
    subOrderId: string,
    opts: {
      actorId?: string;
      actorRole?: string;
      collectedAmountInPaise?: bigint;
      collectionReference?: string;
      notes?: string;
      varianceReason?: string;
      ipAddress?: string;
      userAgent?: string;
    } = {},
  ) {
    const sub = await this.orderRepo.findSubOrderByIdWithMasterOrder(subOrderId);
    if (!sub) throw new NotFoundAppException('Sub-order not found');
    const master = sub.masterOrder;
    if (!master) throw new NotFoundAppException('Parent order not found');

    if (master.paymentMethod !== 'COD') {
      throw new BadRequestAppException(
        'Per-sub-order mark-paid is for COD orders only.',
        'MARK_PAID_NON_COD',
      );
    }
    if (sub.acceptStatus === 'REJECTED') {
      throw new BadRequestAppException('Cannot collect cash for a rejected sub-order');
    }
    if (sub.fulfillmentStatus !== 'DELIVERED') {
      throw new BadRequestAppException(
        'Cannot mark a sub-order as paid before it is DELIVERED',
      );
    }
    if (sub.paymentStatus === 'PAID') {
      throw new BadRequestAppException('Sub-order is already marked as paid');
    }
    if (sub.paymentStatus === 'CANCELLED') {
      throw new BadRequestAppException('Cannot mark a cancelled sub-order as paid');
    }

    // Per-sub cash due = this sub's subtotal MINUS its prorated share of the
    // master-level wallet credit (wallet is stored only on the master order).
    // Use the Decimal subTotal; subTotalInPaise is a dual-write mirror that is
    // 0 when MONEY_DUAL_WRITE_ENABLED=false.
    const subGrossInPaise = BigInt(Math.round(Number(sub.subTotal) * 100));
    const walletShareInPaise = BigInt(
      this.proratedWalletShareInPaise(master, sub),
    );
    const expectedInPaise =
      subGrossInPaise > walletShareInPaise
        ? subGrossInPaise - walletShareInPaise
        : 0n;
    const collectedInPaise = opts.collectedAmountInPaise ?? expectedInPaise;
    if (collectedInPaise < 0n) {
      throw new BadRequestAppException('collectedAmountInPaise cannot be negative');
    }
    const varianceInPaise = collectedInPaise - expectedInPaise;
    if (varianceInPaise !== 0n && !opts.varianceReason?.trim()) {
      throw new BadRequestAppException(
        `Collected amount does not match the sub-order payable; a varianceReason ` +
          `is required to record a cash discrepancy.`,
        'COD_CASH_VARIANCE_UNEXPLAINED',
      );
    }

    const paidAt = new Date();
    const activeSubs = (master.subOrders ?? []).filter(
      (so: any) => so.acceptStatus !== 'REJECTED',
    );

    const result = await this.orderRepo.executeTransaction(async (tx) => {
      // CAS on the sub-order flip.
      const flip = await tx.subOrder.updateMany({
        where: { id: subOrderId, paymentStatus: 'PENDING' },
        data: {
          paymentStatus: 'PAID',
          paidAt,
          paidBy: opts.actorId ?? null,
          paymentReference: opts.collectionReference ?? null,
        },
      });
      if (flip.count === 0) return { flipped: false, masterFlipped: false };

      await tx.cashCollection.create({
        data: {
          masterOrderId: master.id,
          subOrderId,
          expectedAmountInPaise: expectedInPaise,
          collectedAmountInPaise: collectedInPaise,
          varianceInPaise,
          varianceReason: opts.varianceReason?.trim() || null,
          collectionReference: opts.collectionReference ?? null,
          notes: opts.notes ?? null,
          collectedByAdminId: opts.actorId ?? null,
          collectedAt: paidAt,
        },
      });

      // Recompute master from siblings RE-READ INSIDE THE TX (not the pre-tx
      // snapshot). Phase 168 review (L1) — two admins collecting two different
      // sub-orders of the same order concurrently would each see the OTHER as
      // still PENDING off the stale snapshot, so NEITHER would flip the master
      // → an all-paid order stuck PENDING + the captured event never fires.
      // Re-reading here means the second committer sees the first's PAID flip.
      const freshSiblings = await tx.subOrder.findMany({
        where: { masterOrderId: master.id },
        select: { id: true, acceptStatus: true, paymentStatus: true },
      });
      const freshActive = freshSiblings.filter(
        (s: any) => s.acceptStatus !== 'REJECTED',
      );
      const allActivePaid =
        freshActive.length > 0 &&
        freshActive.every((s: any) => s.paymentStatus === 'PAID');
      let masterFlipped = false;
      if (allActivePaid && master.paymentStatus === 'PENDING') {
        const willTouchOrderStatus = isTransitionAllowed(
          'OrderStatus',
          master.orderStatus,
          'DELIVERED',
        );
        const mflip = await tx.masterOrder.updateMany({
          where: { id: master.id, paymentStatus: 'PENDING' },
          data: willTouchOrderStatus
            ? { paymentStatus: 'PAID', orderStatus: 'DELIVERED', paidAt, paidBy: opts.actorId ?? null }
            : { paymentStatus: 'PAID', paidAt, paidBy: opts.actorId ?? null },
        });
        masterFlipped = mflip.count > 0;
        if (masterFlipped) {
          await this.eventBus.publish(
            {
              eventName: 'payments.payment.captured',
              aggregate: 'MasterOrder',
              aggregateId: master.id,
              occurredAt: paidAt,
              payload: {
                masterOrderId: master.id,
                orderNumber: master.orderNumber,
                customerId: master.customerId,
                amount: Number(master.totalAmount),
                amountInPaise: BigInt(master.totalAmountInPaise).toString(),
                paymentMethod: master.paymentMethod,
                source: 'admin.markSubOrderAsPaid',
              },
            },
            { tx },
          );
        }
      }
      return { flipped: true, masterFlipped };
    });

    if (!result.flipped) {
      throw new BadRequestAppException('Sub-order is already marked as paid');
    }

    await this.auditFacade
      ?.writeAuditLog({
        actorId: opts.actorId,
        actorRole: opts.actorRole,
        action: 'COD_SUBORDER_MARK_PAID',
        module: 'orders',
        resource: 'SubOrder',
        resourceId: subOrderId,
        oldValue: { paymentStatus: sub.paymentStatus },
        newValue: { paymentStatus: 'PAID', masterFlipped: result.masterFlipped },
        metadata: {
          masterOrderId: master.id,
          orderNumber: master.orderNumber,
          expectedInPaise: expectedInPaise.toString(),
          collectedInPaise: collectedInPaise.toString(),
          varianceInPaise: varianceInPaise.toString(),
          varianceReason: opts.varianceReason ?? null,
          collectionReference: opts.collectionReference ?? null,
        },
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `markSubOrderAsPaid: audit write failed for ${subOrderId}: ${(err as Error)?.message ?? err}`,
        ),
      );

    return { subOrderPaid: true, masterPaid: result.masterFlipped };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Admin reassignment methods (Epic 2)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Get eligible sellers for a sub-order's items, ranked by allocation score.
   * Excludes the current seller.
   */
  async getEligibleSellers(subOrderId: string) {
    const subOrder =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const addressSnapshot =
      subOrder.masterOrder.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;
    if (!customerPincode) {
      throw new BadRequestAppException(
        'Cannot determine customer pincode from shipping address',
      );
    }

    // Find ALL sellers who have already rejected or been assigned this order
    const allSubOrders = await this.orderRepo.findSubOrdersByMasterOrder(
      subOrder.masterOrder.id,
    );
    const excludeSellerIds = new Set<string>();
    excludeSellerIds.add(subOrder.sellerId);
    for (const so of allSubOrders) {
      if (so.acceptStatus === 'REJECTED') {
        excludeSellerIds.add(so.sellerId);
      }
    }

    // Get mapping IDs to exclude
    const excludeMappingIds: string[] = [];
    for (const item of subOrder.items) {
      const ids = await this.orderRepo.findSellerProductMappingIds(
        item.productId,
        item.variantId,
        Array.from(excludeSellerIds),
      );
      excludeMappingIds.push(...ids);
    }

    // Collect eligible sellers across all items, intersecting eligibility
    const sellerScoresMap = new Map<
      string,
      {
        sellerId: string;
        sellerName: string;
        shopName: string;
        // Phase 64 (2026-05-22) — nullable for no-coords mappings
        // (audit Gap #9). Pre-Phase-64 a placeholder 999km was
        // used; now no-coords candidates are represented honestly.
        distanceKm: number | null;
        dispatchSla: number;
        availableStock: number;
        score: number;
      }
    >();

    for (const item of subOrder.items) {
      try {
        const allocation = await this.catalogFacade.allocate({
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          customerPincode,
          quantity: item.quantity,
          excludeMappingIds,
          // Phase 233 — admin browse, not a real checkout decision: keep it out
          // of allocation analytics.
          eventSource: 'LISTING',
        });

        if (allocation.allEligible) {
          for (const seller of allocation.allEligible) {
            if (excludeSellerIds.has(seller.sellerId)) continue;

            const existing = sellerScoresMap.get(seller.sellerId);
            if (!existing || seller.score > existing.score) {
              const sellerRecord = await this.orderRepo.findSeller(
                seller.sellerId,
              );

              sellerScoresMap.set(seller.sellerId, {
                sellerId: seller.sellerId,
                sellerName:
                  sellerRecord?.sellerName || seller.sellerName,
                shopName:
                  sellerRecord?.sellerShopName || seller.sellerName,
                distanceKm: seller.distanceKm,
                dispatchSla: seller.dispatchSla,
                availableStock: seller.availableStock,
                score: seller.score,
              });
            }
          }
        }
      } catch {
        // If allocation throws for an item, continue
      }
    }

    // Sort by score descending — NOTE: this still ONLY contains sellers.
    // The node-agnostic equivalent is `getEligibleNodes`. We keep this method
    // for backward-compat with existing callers that only want sellers.
    const sellers = Array.from(sellerScoresMap.values()).sort(
      (a, b) => b.score - a.score,
    );
    return sellers;
  }

  /**
   * Node-agnostic version of getEligibleSellers — returns both sellers AND
   * franchises that can fulfill this sub-order, ranked by allocation score.
   * Each entry carries a `nodeType` discriminator plus the corresponding ID.
   */
  async getEligibleNodes(subOrderId: string) {
    const subOrder =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    if (!subOrder) throw new NotFoundAppException('Sub-order not found');

    const addressSnapshot =
      subOrder.masterOrder.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;
    if (!customerPincode) {
      throw new BadRequestAppException(
        'Cannot determine customer pincode from shipping address',
      );
    }

    // Exclude the currently-assigned node and anyone who already rejected
    // this master order — so the admin doesn't see the same rejector again.
    const allSubOrders = await this.orderRepo.findSubOrdersByMasterOrder(
      subOrder.masterOrder.id,
    );
    const excludeSellerIds = new Set<string>();
    const excludeFranchiseIds = new Set<string>();
    if (subOrder.sellerId) excludeSellerIds.add(subOrder.sellerId);
    if ((subOrder as any).franchiseId)
      excludeFranchiseIds.add((subOrder as any).franchiseId);
    for (const so of allSubOrders) {
      if (so.acceptStatus === 'REJECTED') {
        if (so.sellerId) excludeSellerIds.add(so.sellerId);
        if ((so as any).franchiseId)
          excludeFranchiseIds.add((so as any).franchiseId);
      }
    }

    // Intersect eligibility across items — a candidate only qualifies if
    // they can fulfill every line.
    type NodeCandidate = {
      nodeType: 'SELLER' | 'FRANCHISE';
      nodeId: string;
      name: string;
      // Phase 64 — nullable (audit Gap #9).
      distanceKm: number | null;
      dispatchSla: number;
      availableStock: number;
      score: number;
    };
    const scoreMap = new Map<string, NodeCandidate>();

    // Phase 231 — COD orders must not list non-COD nodes (reassigning to one
    // just guarantees a downstream rejection). Defensive: if paymentMethod
    // isn't on the loaded master, default to ONLINE (no COD filter).
    const orderPaymentMethod: 'COD' | 'ONLINE' =
      (subOrder.masterOrder as any).paymentMethod === 'COD' ? 'COD' : 'ONLINE';

    for (const item of subOrder.items) {
      try {
        const allocation = await this.catalogFacade.allocate({
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          customerPincode,
          quantity: item.quantity,
          paymentMethod: orderPaymentMethod,
          // Phase 233 — admin browse, not a real checkout decision.
          eventSource: 'LISTING',
        });

        if (allocation.allEligible) {
          for (const node of allocation.allEligible) {
            const isFranchise = node.nodeType === 'FRANCHISE';
            const nodeId = isFranchise
              ? node.franchiseId ?? node.sellerId
              : node.sellerId;

            if (!isFranchise && excludeSellerIds.has(nodeId)) continue;
            if (isFranchise && excludeFranchiseIds.has(nodeId)) continue;

            const key = `${node.nodeType}:${nodeId}`;
            const existing = scoreMap.get(key);
            if (!existing || node.score > existing.score) {
              scoreMap.set(key, {
                nodeType: node.nodeType,
                nodeId,
                name: node.sellerName,
                distanceKm: node.distanceKm,
                dispatchSla: node.dispatchSla,
                availableStock: node.availableStock,
                score: node.score,
              });
            }
          }
        }
      } catch {
        // per-item allocation failure shouldn't kill the whole listing
      }
    }

    return Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Manually reassign a sub-order to a different node (seller OR franchise).
   *
   * Phase 78 (2026-05-22) — wholesale refactor closing 13 audit gaps:
   *
   *   • Gap #1/#4   reason is now required (10+ chars). Canned fallback
   *                 string removed from the audit log writer.
   *   • Gap #2      seller CONFIRMED reservation now correctly debits
   *                 mapping.stockQty + variant.stock (was leaving stockQty
   *                 untouched while bumping reservedQty — phantom hold).
   *   • Gap #3/#14  entire body wrapped in ONE prisma.$transaction:
   *                 sub-order CAS-update, previous-stock release, new
   *                 stock confirm, AllocationLog, OrderReassignmentLog,
   *                 and outbox event all commit-or-rollback together.
   *   • Gap #5      reassignedBy admin id threaded through and persisted.
   *   • Gap #9      previous-seller release scoped to THIS sub-order's
   *                 items via `restoreForSubOrderItems` (was releasing
   *                 every reservation the seller held for the whole
   *                 master order — over-release).
   *   • Gap #10     seller mapping lookup accepts variant-fallback (OR
   *                 variantId=NULL) — matches the franchise side.
   *   • Gap #15     event published via EventBusService with `{ tx }` so
   *                 the outbox row commits atomically with the writes.
   *   • Gap #16     SubOrder.reassignmentCount incremented + sequence
   *                 number stamped on the log row.
   *   • Gap #19     `force: true` allows ACCEPTED+UNFULFILLED reassign
   *                 (gated by `orders.reassign.force` at controller).
   *   • Gap #20     SELECT FOR UPDATE on the new seller mapping before
   *                 the reserve write — closes the validate-vs-write
   *                 race window.
   *   • Gap #21     ONE AllocationLog per reassignment (was one per
   *                 item — bloated the table).
   *   • Gap #22     fromNodeType / toNodeType discriminator columns
   *                 populated; legacy seller-id columns kept for
   *                 back-compat readers.
   *   • R1          inside-tx re-check of (sellerId/franchiseId,
   *                 acceptStatus) catches a second admin who reassigned
   *                 between our validation and our write.
   *
   * Signature accepts either a legacy string sellerId or a typed target
   * `{ nodeType, nodeId }`. The previous node may be seller or franchise;
   * stock release branches on the CURRENT assignment.
   */
  async reassignSubOrder(
    subOrderId: string,
    target: ReassignTarget | string,
    reason: string,
    adminId?: string,
    opts?: { force?: boolean },
  ) {
    if (!subOrderId)
      throw new BadRequestAppException('subOrderId is required');

    // Phase 78 Gap #1/#4 — reason is required, server-side. The DTO
    // also enforces this at the controller layer, but the service is
    // public to internal callers (admin-control-tower facade routed
    // here in Phase 78) so the guard belongs in both places.
    if (!reason || !reason.trim() || reason.trim().length < 10) {
      throw new BadRequestAppException(
        'reason is required (minimum 10 characters)',
      );
    }

    // Normalize legacy string form
    const newTarget: ReassignTarget =
      typeof target === 'string'
        ? { nodeType: 'SELLER', nodeId: target }
        : target;

    if (!newTarget?.nodeId)
      throw new BadRequestAppException('target nodeId is required');
    const rawNodeType = (newTarget as { nodeType: string }).nodeType;
    if (rawNodeType !== 'SELLER' && rawNodeType !== 'FRANCHISE') {
      throw new BadRequestAppException(
        `Invalid nodeType: ${rawNodeType}. Must be 'SELLER' or 'FRANCHISE'.`,
      );
    }

    const force = !!opts?.force;
    const trimmedReason = reason.trim();

    // 1. Get the sub-order with items
    const subOrder =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    if (!subOrder)
      throw new NotFoundAppException(`Sub-order ${subOrderId} not found`);

    const previousSellerId: string | null = subOrder.sellerId ?? null;
    const previousFranchiseId: string | null =
      (subOrder as any).franchiseId ?? null;
    const previousNodeType: 'SELLER' | 'FRANCHISE' =
      ((subOrder as any).fulfillmentNodeType as 'SELLER' | 'FRANCHISE') ||
      (previousFranchiseId ? 'FRANCHISE' : 'SELLER');

    // Reject no-op reassignment (same node)
    if (
      newTarget.nodeType === 'SELLER' &&
      previousSellerId === newTarget.nodeId
    ) {
      throw new BadRequestAppException(
        'Sub-order is already assigned to this seller',
      );
    }
    if (
      newTarget.nodeType === 'FRANCHISE' &&
      previousFranchiseId === newTarget.nodeId
    ) {
      throw new BadRequestAppException(
        'Sub-order is already assigned to this franchise',
      );
    }

    // Phase 78 Gap #19 — `force: true` admits ACCEPTED+UNFULFILLED in
    // addition to the standard OPEN/REJECTED gate. Anything past
    // PACKED (goods physically prepared) stays blocked regardless of
    // force — that's a returns problem, not a reassignment.
    const standardStates = new Set(['OPEN', 'REJECTED']);
    const isForceEligible =
      force &&
      subOrder.acceptStatus === 'ACCEPTED' &&
      subOrder.fulfillmentStatus === 'UNFULFILLED';
    if (!standardStates.has(subOrder.acceptStatus) && !isForceEligible) {
      throw new BadRequestAppException(
        `Cannot reassign sub-order with accept status ${subOrder.acceptStatus}${force ? ` and fulfillment status ${subOrder.fulfillmentStatus}` : ''}. Only OPEN or REJECTED${force ? ' (or ACCEPTED+UNFULFILLED with force)' : ''} sub-orders can be reassigned.`,
      );
    }

    // 2. Validate new node exists, is ACTIVE, has mapping + stock for every item
    if (newTarget.nodeType === 'SELLER') {
      const newSeller = await this.orderRepo.findSeller(newTarget.nodeId);
      if (!newSeller)
        throw new NotFoundAppException(`Seller ${newTarget.nodeId} not found`);
      if (newSeller.status !== 'ACTIVE') {
        throw new BadRequestAppException(
          `Seller ${newTarget.nodeId} is not active (status: ${newSeller.status})`,
        );
      }
      for (const item of subOrder.items) {
        // Phase 78 Gap #10 — variant fallback parity with franchise side.
        // Pre-Phase-78 sellers required a variant-exact mapping; the
        // franchise side accepted variantId=NULL fallback. Routing rules
        // were therefore inconsistent — same scenario rejected for
        // seller, accepted for franchise.
        const mappingWhere: any = {
          sellerId: newTarget.nodeId,
          productId: item.productId,
          isActive: true,
        };
        if (item.variantId) {
          mappingWhere.OR = [
            { variantId: item.variantId },
            { variantId: null },
          ];
        } else {
          mappingWhere.variantId = null;
        }
        // orderBy variant DESC → variant-specific wins over wildcard
        // when both exist.
        const mapping = await this.prisma.sellerProductMapping.findFirst({
          where: mappingWhere,
          orderBy: [{ variantId: 'desc' }, { id: 'asc' }],
        });
        if (!mapping) {
          throw new BadRequestAppException(
            `Seller ${newTarget.nodeId} does not have an active mapping for product ${item.productId}${item.variantId ? ` / variant ${item.variantId}` : ''}`,
          );
        }
        const available = mapping.stockQty - mapping.reservedQty;
        if (available < item.quantity) {
          throw new BadRequestAppException(
            `Seller ${newTarget.nodeId} has insufficient stock for product ${item.productId}: available=${available}, required=${item.quantity}`,
          );
        }
      }
    } else {
      // FRANCHISE target
      const franchise = await this.prisma.franchisePartner.findUnique({
        where: { id: newTarget.nodeId },
        select: { id: true, status: true, businessName: true, isDeleted: true },
      });
      if (!franchise || franchise.isDeleted) {
        throw new NotFoundAppException(
          `Franchise ${newTarget.nodeId} not found`,
        );
      }
      // Operational = ACTIVE or APPROVED. APPROVED franchises can fulfill
      // orders just like ACTIVE ones; only PENDING / SUSPENDED / DEACTIVATED
      // are blocked. Same precedent as procurement.service.ts.
      const operational =
        franchise.status === 'ACTIVE' || franchise.status === 'APPROVED';
      if (!operational) {
        throw new BadRequestAppException(
          `Franchise ${newTarget.nodeId} is not operational (status: ${franchise.status}). Only ACTIVE or APPROVED franchises can be assigned orders.`,
        );
      }
      for (const item of subOrder.items) {
        // Accept either a variant-specific mapping or a product-level
        // (variantId=NULL) mapping that implicitly covers all variants.
        const mappingWhere: any = {
          franchiseId: newTarget.nodeId,
          productId: item.productId,
          isActive: true,
          approvalStatus: 'APPROVED',
        };
        if (item.variantId) {
          mappingWhere.OR = [
            { variantId: item.variantId },
            { variantId: null },
          ];
        } else {
          mappingWhere.variantId = null;
        }
        const mapping = await this.prisma.franchiseCatalogMapping.findFirst({
          where: mappingWhere,
          select: { id: true },
        });
        if (!mapping) {
          throw new BadRequestAppException(
            `Franchise ${newTarget.nodeId} does not have an approved mapping for product ${item.productId}${item.variantId ? ` / variant ${item.variantId}` : ''}`,
          );
        }

        // Stock lookup: prefer variant-specific row, fall back to product-level.
        let stock: { availableQty: number } | null = null;
        if (item.variantId) {
          stock = await this.prisma.franchiseStock.findFirst({
            where: {
              franchiseId: newTarget.nodeId,
              productId: item.productId,
              variantId: item.variantId,
            },
            select: { availableQty: true },
          });
        }
        if (!stock) {
          stock = await this.prisma.franchiseStock.findFirst({
            where: {
              franchiseId: newTarget.nodeId,
              productId: item.productId,
              variantId: null,
            },
            select: { availableQty: true },
          });
        }
        if (!stock || stock.availableQty < item.quantity) {
          throw new BadRequestAppException(
            `Franchise ${newTarget.nodeId} has insufficient stock for product ${item.productId}: available=${stock?.availableQty ?? 0}, required=${item.quantity}`,
          );
        }
      }
    }

    const now = new Date();
    const acceptDeadlineAt = new Date(now.getTime() + this.acceptDeadlineMs());

    // Phase 78 — franchise side compensations.
    //   • A franchise NEW target reserves via the facade which owns its
    //     own persistence path (not expressible as a single Prisma tx
    //     with our repo). We reserve FIRST, then enter the big tx; if
    //     the tx fails we compensate by calling unreserveStock.
    //   • A franchise PREVIOUS hold gets released AFTER the tx commits
    //     so a tx rollback leaves the previous franchise's hold intact
    //     and the order state visibly unchanged.
    const franchiseReservationsCreated: Array<{
      productId: string;
      variantId: string | null;
      quantity: number;
    }> = [];

    if (newTarget.nodeType === 'FRANCHISE') {
      try {
        for (const item of subOrder.items) {
          await this.franchiseFacade.reserveStock(
            newTarget.nodeId,
            item.productId,
            item.variantId ?? null,
            item.quantity,
            subOrder.masterOrder.id,
          );
          franchiseReservationsCreated.push({
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
          });
        }
      } catch (err) {
        // Pre-tx failure — compensate anything we already reserved.
        await this.compensateFranchiseReservations(
          newTarget.nodeId,
          franchiseReservationsCreated,
          subOrder.masterOrder.id,
        );
        throw err;
      }
    }

    let resultSequence = 1;

    try {
      await this.orderRepo.executeTransaction(async (tx) => {
        // 3a. CAS re-check the sub-order state inside the tx. Catches:
        //   • R1 (two admins concurrent reassign — second sees sellerId
        //     already swapped and aborts).
        //   • R8 (same admin double-click — second call sees acceptStatus
        //     OPEN but lastReassignedAt within the burst window;
        //     @Idempotent already cached the response, but this is a
        //     belt-and-braces.)
        const refreshed = await tx.subOrder.findUnique({
          where: { id: subOrderId },
          select: {
            sellerId: true,
            franchiseId: true,
            fulfillmentNodeType: true,
            acceptStatus: true,
            fulfillmentStatus: true,
          },
        });
        if (!refreshed) {
          throw new NotFoundAppException('Sub-order disappeared mid-tx');
        }
        if (
          refreshed.sellerId !== previousSellerId ||
          (refreshed as any).franchiseId !== previousFranchiseId
        ) {
          throw new ConflictAppException(
            'Sub-order was reassigned by another admin — please refresh and try again',
          );
        }
        const stateOk =
          standardStates.has(refreshed.acceptStatus) ||
          (force &&
            refreshed.acceptStatus === 'ACCEPTED' &&
            refreshed.fulfillmentStatus === 'UNFULFILLED');
        if (!stateOk) {
          throw new ConflictAppException(
            `Sub-order state changed mid-tx; cannot reassign (now ${refreshed.acceptStatus}/${refreshed.fulfillmentStatus})`,
          );
        }

        // 3b. Release previous SELLER hold (scoped to THIS sub-order's
        // items — Gap #9 fix). FRANCHISE previous releases AFTER commit
        // because the franchise facade isn't tx-aware.
        if (previousNodeType === 'SELLER' && previousSellerId) {
          await this.stockRestore.restoreForSubOrderItems(
            tx,
            subOrder.masterOrder.id,
            previousSellerId,
            subOrder.items.map((i: any) => ({
              productId: i.productId,
              variantId: i.variantId ?? null,
            })),
          );
        }

        // Phase 88 (2026-05-23) — Shipment Evidence Gap #20.
        // Archive the previous seller's shipment evidence so the
        // new seller's 4-photo gate restarts from zero. Rows are
        // kept (kind=ARCHIVED_REASSIGNMENT) for audit + fraud
        // investigation; only the kind label changes.
        if (this.shipmentEvidence) {
          await this.shipmentEvidence.archiveForReassignment({
            subOrderId,
            previousSellerId,
            reason: 'Sub-order reassigned to a new fulfillment node',
            tx: tx as any,
          });
        }

        // 4. Reserve+confirm on the new SELLER node — inline canonical
        // path (Gap #2 fix). FRANCHISE reserves already happened above.
        if (newTarget.nodeType === 'SELLER') {
          for (const item of subOrder.items) {
            const mappingWhere: any = {
              sellerId: newTarget.nodeId,
              productId: item.productId,
              isActive: true,
            };
            if (item.variantId) {
              mappingWhere.OR = [
                { variantId: item.variantId },
                { variantId: null },
              ];
            } else {
              mappingWhere.variantId = null;
            }
            const mapping = await tx.sellerProductMapping.findFirst({
              where: mappingWhere,
              orderBy: [{ variantId: 'desc' }, { id: 'asc' }],
            });
            if (!mapping) {
              throw new BadRequestAppException(
                `Mapping vanished mid-tx for product ${item.productId}`,
              );
            }

            // Gap #20 — FOR UPDATE lock on the mapping row so a
            // concurrent customer reservation can't deplete the stock
            // between our validation snapshot and this write.
            const locked = await tx.$queryRaw<
              Array<{ id: string; stock_qty: number; reserved_qty: number }>
            >`
              SELECT id, stock_qty, reserved_qty
              FROM seller_product_mappings
              WHERE id = ${mapping.id}
              FOR UPDATE
            `;
            const lockedRow = locked[0];
            if (!lockedRow) {
              throw new NotFoundAppException('Mapping vanished under lock');
            }
            // CONFIRMED debits stockQty directly (no intermediate
            // RESERVED hold), so the check is against stockQty alone,
            // not (stockQty - reservedQty).
            if (lockedRow.stock_qty < item.quantity) {
              throw new ConflictAppException(
                `Stock changed under lock for product ${item.productId}: stockQty=${lockedRow.stock_qty}, required=${item.quantity}`,
              );
            }

            // Gap #2 fix — mirror confirmReservation's state machine:
            // CONFIRMED status, stockQty -=qty, variant.stock -=qty.
            // reservedQty is NOT bumped (we never went through a
            // RESERVED hold).
            await tx.stockReservation.create({
              data: {
                mappingId: mapping.id,
                quantity: item.quantity,
                status: 'CONFIRMED',
                orderId: subOrder.masterOrder.id,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              },
            });
            await tx.sellerProductMapping.update({
              where: { id: mapping.id },
              data: { stockQty: { decrement: item.quantity } },
            });
            if (mapping.variantId) {
              await tx.productVariant.update({
                where: { id: mapping.variantId },
                data: { stock: { decrement: item.quantity } },
              });
            } else {
              await tx.product.update({
                where: { id: mapping.productId },
                data: { baseStock: { decrement: item.quantity } },
              });
            }
          }
        }

        // 5. Compute reassignment sequence (Gap #16) BEFORE writing the
        // log row so the new row gets the correct sequence number.
        const priorReassignments = await tx.orderReassignmentLog.count({
          where: { subOrderId },
        });
        resultSequence = priorReassignments + 1;

        // 6. Update the sub-order row + promote master out of
        // EXCEPTION_QUEUE.
        await tx.subOrder.update({
          where: { id: subOrderId },
          data: {
            sellerId:
              newTarget.nodeType === 'SELLER' ? newTarget.nodeId : null,
            franchiseId:
              newTarget.nodeType === 'FRANCHISE' ? newTarget.nodeId : null,
            fulfillmentNodeType: newTarget.nodeType,
            acceptStatus: 'OPEN',
            fulfillmentStatus: 'UNFULFILLED',
            acceptDeadlineAt,
            // Gap #16 — visibility counter.
            reassignmentCount: { increment: 1 },
            lastReassignedAt: now,
          } as any,
        });

        // Phase 234 (Exception Queue audit) — only promote the master OUT of
        // EXCEPTION_QUEUE when EVERY non-REJECTED sub-order has actually been
        // routed (acceptDeadlineAt is stamped at verify-route AND at reassign,
        // so a null deadline means "still unrouted/unserviceable"). Pre-234 a
        // single reassign flipped the master straight to ROUTED_TO_SELLER even
        // if other sub-orders were still stuck — prematurely "resolving" a
        // still-broken order and hiding it from the exception queue. We scan
        // siblings IN-TX so this row's just-set acceptDeadlineAt is visible.
        if (subOrder.masterOrder.orderStatus === 'EXCEPTION_QUEUE') {
          const siblings = await tx.subOrder.findMany({
            where: { masterOrderId: subOrder.masterOrder.id },
            select: { acceptStatus: true, acceptDeadlineAt: true },
          });
          const active = siblings.filter(
            (s: any) => s.acceptStatus !== 'REJECTED',
          );
          const allRouted =
            active.length > 0 &&
            active.every((s: any) => s.acceptDeadlineAt !== null);
          if (allRouted) {
            await tx.masterOrder.update({
              where: { id: subOrder.masterOrder.id },
              data: {
                orderStatus: 'ROUTED_TO_SELLER',
                // Clear the exception provenance now that it's resolved.
                exceptionReason: null,
                exceptionReasonDetail: null,
                exceptionEnteredAt: null,
              },
            });
          }
        }

        // 7. Gap #21 — ONE AllocationLog per reassignment, summarising
        // all items, instead of N rows. The other items' productIds are
        // captured in the reason text so a forensic query can still find
        // them. The header row uses the first item's productId/variantId.
        const itemSummary = subOrder.items
          .map((i: any) =>
            i.variantId
              ? `${i.productId}/${i.variantId}×${i.quantity}`
              : `${i.productId}×${i.quantity}`,
          )
          .join(', ');
        await tx.allocationLog.create({
          data: {
            productId: subOrder.items[0]!.productId,
            variantId: subOrder.items[0]!.variantId,
            customerPincode: 'ADMIN_REASSIGN',
            allocatedNodeType: newTarget.nodeType,
            allocatedSellerId:
              newTarget.nodeType === 'SELLER' ? newTarget.nodeId : null,
            allocatedFranchiseId:
              newTarget.nodeType === 'FRANCHISE' ? newTarget.nodeId : null,
            allocationReason:
              `Admin manual reassignment (seq ${resultSequence}, ${subOrder.items.length} item(s): ${itemSummary}): ` +
              `from ${previousNodeType.toLowerCase()} ${previousSellerId ?? previousFranchiseId ?? 'NONE'} ` +
              `to ${newTarget.nodeType.toLowerCase()} ${newTarget.nodeId} — ${trimmedReason}` +
              (force ? ' [force]' : ''),
            // Phase 233 — tag this as a manual reassignment so allocation
            // analytics counts it in the REASSIGNED bucket (and excludes it
            // from LIVE checkout decisions) instead of being an indistinct row.
            eventSource: 'MANUAL_REASSIGNMENT',
            outcome: 'REASSIGNED',
            reasonCode: 'MANUAL_REASSIGN',
            isReallocated: true,
            orderId: subOrder.masterOrder.id,
          } as any,
        });

        // 8. OrderReassignmentLog INSIDE the tx (Gap #4/#14). Lets
        // the audit row roll back atomically with the writes; pre-Phase-78
        // the .catch(() => {}) swallowed DB errors so we could end up
        // with a reassigned sub-order and NO log row.
        await tx.orderReassignmentLog.create({
          data: {
            subOrderId,
            masterOrderId: subOrder.masterOrder.id,
            // Phase 78 — new discriminator columns (Gap #8/#22)
            fromNodeType: previousNodeType,
            fromNodeId: previousSellerId ?? previousFranchiseId ?? null,
            toNodeType: newTarget.nodeType,
            toNodeId: newTarget.nodeId,
            // Legacy columns kept for back-compat readers
            fromSellerId: previousSellerId ?? previousFranchiseId ?? '',
            toSellerId: newTarget.nodeId,
            reason: trimmedReason,
            successful: true,
            // Gap #5 — admin actor
            reassignedBy: adminId ?? null,
            // Gap #16 — sequence number
            reassignmentSequence: resultSequence,
            newSubOrderId: null,
            // Phase 79 — Gap #6. Discriminates the manual admin path
            // from system auto-cascades in the history UI.
            eventType: 'ADMIN_MANUAL_OVERRIDE',
          } as any,
        });

        // Phase 84 (2026-05-23) — timeline event for SUBORDER_REASSIGNED.
        if (this.timeline) {
          await this.timeline.record(
            {
              masterOrderId: subOrder.masterOrder.id,
              subOrderId,
              eventType: 'SUBORDER_REASSIGNED',
              actorType: adminId ? 'ADMIN' : 'SYSTEM',
              actorId: adminId,
              reason: trimmedReason,
              metadata: {
                fromNodeType: previousNodeType,
                fromNodeId: previousSellerId ?? previousFranchiseId,
                toNodeType: newTarget.nodeType,
                toNodeId: newTarget.nodeId,
                sequence: resultSequence,
              },
            },
            tx,
          );
        }

        // 9. Publish via outbox-aware path (Gap #15). With OUTBOX_DUAL_WRITE
        // on, the outbox row is written inside this tx — at-least-once
        // delivery with full atomicity. With it off, falls back to
        // queueMicrotask direct emit (legacy semantics, but reliable for
        // dev/test where the publisher cron isn't running).
        await this.eventBus.publish(
          {
            eventName: 'orders.sub_order.reassigned',
            aggregate: 'SubOrder',
            aggregateId: subOrderId,
            occurredAt: now,
            payload: {
              subOrderId,
              masterOrderId: subOrder.masterOrder.id,
              orderNumber: subOrder.masterOrder.orderNumber,
              fromNodeType: previousNodeType,
              fromNodeId: previousSellerId ?? previousFranchiseId,
              toNodeType: newTarget.nodeType,
              toNodeId: newTarget.nodeId,
              // Legacy fields kept for existing consumers
              fromSellerId: previousSellerId,
              toSellerId:
                newTarget.nodeType === 'SELLER' ? newTarget.nodeId : null,
              reason: trimmedReason,
              reassignedBy: adminId ?? null,
              reassignmentSequence: resultSequence,
              force,
            },
          },
          { tx },
        );
      });
    } catch (err) {
      // Tx failed (or compensated row mismatch from CAS check) —
      // unwind any franchise reservations created outside the tx so
      // we don't leak a hold on the new franchise.
      await this.compensateFranchiseReservations(
        newTarget.nodeType === 'FRANCHISE' ? newTarget.nodeId : null,
        franchiseReservationsCreated,
        subOrder.masterOrder.id,
      );
      throw err;
    }

    // 10. Release previous FRANCHISE hold AFTER commit. The franchise
    // facade isn't tx-aware; if this fails the previous franchise keeps
    // a stale hold but the sub-order is correctly reassigned. Logged so
    // ops can reconcile.
    if (previousNodeType === 'FRANCHISE' && previousFranchiseId) {
      for (const item of subOrder.items) {
        await this.franchiseFacade
          .unreserveStock(
            previousFranchiseId,
            item.productId,
            item.variantId ?? null,
            item.quantity,
            subOrder.masterOrder.id,
          )
          .catch((e) => {
            this.logger.warn(
              `Franchise unreserve failed for previous franchise ${previousFranchiseId} on sub-order ${subOrderId}: ${
                (e as Error).message
              }`,
            );
          });
      }
    }

    // Phase 230/231 (Eligible-node listing audit) — hash-chained audit_logs
    // row. Pre-230 a reassignment wrote OrderReassignmentLog + AllocationLog +
    // timeline + outbox event, but NOT the tamper-evident audit chain every
    // other risk-sensitive admin action uses. Best-effort, after commit.
    if (this.auditFacade) {
      await this.auditFacade
        .writeAuditLog({
          actorId: adminId ?? 'SYSTEM',
          actorRole: adminId ? 'ADMIN' : 'SYSTEM',
          action: 'SUB_ORDER_REASSIGNED',
          module: 'orders',
          resource: 'SubOrder',
          resourceId: subOrderId,
          oldValue: {
            nodeType: previousNodeType,
            nodeId: previousSellerId ?? previousFranchiseId ?? null,
          },
          newValue: {
            nodeType: newTarget.nodeType,
            nodeId: newTarget.nodeId,
            masterOrderId: subOrder.masterOrder.id,
            orderNumber: subOrder.masterOrder.orderNumber,
            reason: trimmedReason,
            reassignmentSequence: resultSequence,
            force,
          },
        } as any)
        .catch(() => undefined);
    }

    const updated =
      await this.orderRepo.findSubOrderByIdWithItems(subOrderId);
    return updated;
  }

  /**
   * Phase 78 — compensation helper for franchise reservations that were
   * created OUTSIDE the main reassignment tx and need to be unwound on
   * tx failure. Best-effort; if individual unreserves fail we log and
   * continue (the franchise facade is idempotent on the underlying
   * mappings).
   */
  private async compensateFranchiseReservations(
    franchiseId: string | null,
    reservations: Array<{
      productId: string;
      variantId: string | null;
      quantity: number;
    }>,
    masterOrderId: string,
  ): Promise<void> {
    if (!franchiseId || reservations.length === 0) return;
    for (const r of reservations) {
      try {
        await this.franchiseFacade.unreserveStock(
          franchiseId,
          r.productId,
          r.variantId,
          r.quantity,
          masterOrderId,
        );
      } catch (e) {
        this.logger.warn(
          `Franchise reservation compensation failed for ${franchiseId} ${r.productId}: ${
            (e as Error).message
          }`,
        );
      }
    }
  }

  /**
   * Phase 79 (2026-05-22) — history audit Gaps #7/#9/#10/#11/#15.
   * Canonical reader for the dedicated history endpoint AND the
   * embedded card in getOrder. Returns the enriched + paginated +
   * filtered shape so callers don't repeat the enrichment logic.
   *
   * Pagination is cursor-based (`before` = createdAt of the
   * earliest row returned last page); secondary id sort guarantees
   * a deterministic boundary between pages even when two rows
   * share a millisecond.
   *
   * `total` is returned alongside the page so the UI can show
   * "Showing 20 of 53" without an extra round trip.
   */
  async getReassignmentHistory(
    masterOrderId: string,
    opts: {
      limit?: number;
      before?: Date;
      from?: Date;
      to?: Date;
      eventType?:
        | 'ADMIN_MANUAL_OVERRIDE'
        | 'AUTO_AFTER_SELLER_REJECT'
        | 'AUTO_AFTER_FRANCHISE_REJECT'
        | 'AUTO_AFTER_EXCEPTION_REMEDIATE';
    } = {},
  ) {
    const [rows, total] = await Promise.all([
      this.orderRepo.findReassignmentLogs(masterOrderId, opts),
      this.orderRepo.countReassignmentLogs(masterOrderId, {
        from: opts.from,
        to: opts.to,
        eventType: opts.eventType,
      }),
    ]);
    const enriched = await this.enrichReassignmentLogs(rows);
    const nextCursor =
      enriched.length === (opts.limit ?? 50) && enriched.length > 0
        ? enriched[enriched.length - 1]!.createdAt
        : null;
    return {
      items: enriched,
      total,
      nextCursor,
    };
  }

  /**
   * Phase 79 — history audit Gap #2/#9/#13. Batched-fan-out enrichment
   * for reassignment logs.
   *
   *   • Distinct seller / franchise / admin / sub-order ids are
   *     collected in a single pass.
   *   • One findMany per actor table — total 4 (not 4×N).
   *   • Maps back by id so each log row gets its enriched names.
   *
   * Returns the input shape augmented with:
   *   { fromName, toName,                  // resolved by nodeType
   *     reassignedByName,                  // admin display name
   *     subOrderItemCount, subOrderIndex,  // sub-order context (Gap #5)
   *     newSubOrderItemCount, newSubOrderIndex,  // (Gap #13)
   *     fromSellerName, toSellerName       // legacy compat fields
   *   }
   */
  private async enrichReassignmentLogs(rows: any[]): Promise<any[]> {
    if (rows.length === 0) return [];

    // Collect distinct ids per category. fromNodeType+toNodeType
    // determines whether to enrich from Seller or FranchisePartner.
    const sellerIds = new Set<string>();
    const franchiseIds = new Set<string>();
    const adminIds = new Set<string>();
    const subOrderIds = new Set<string>();
    for (const r of rows) {
      if (r.fromNodeType === 'FRANCHISE' && r.fromNodeId) franchiseIds.add(r.fromNodeId);
      else if (r.fromNodeId) sellerIds.add(r.fromNodeId);
      // Some legacy rows have fromSellerId but no fromNodeId — fall back.
      if (!r.fromNodeId && r.fromSellerId) sellerIds.add(r.fromSellerId);

      if (r.toNodeType === 'FRANCHISE' && r.toNodeId) franchiseIds.add(r.toNodeId);
      else if (r.toNodeId) sellerIds.add(r.toNodeId);
      if (!r.toNodeId && r.toSellerId) sellerIds.add(r.toSellerId);

      if (r.reassignedBy) adminIds.add(r.reassignedBy);
      if (r.subOrderId) subOrderIds.add(r.subOrderId);
      if (r.newSubOrderId) subOrderIds.add(r.newSubOrderId);
    }

    const [sellers, franchises, admins, subOrders] = await Promise.all([
      sellerIds.size > 0
        ? this.prisma.seller.findMany({
            where: { id: { in: Array.from(sellerIds) } },
            select: { id: true, sellerName: true, sellerShopName: true },
          })
        : Promise.resolve([]),
      franchiseIds.size > 0
        ? this.prisma.franchisePartner.findMany({
            where: { id: { in: Array.from(franchiseIds) } },
            select: { id: true, businessName: true },
          })
        : Promise.resolve([]),
      adminIds.size > 0
        ? this.prisma.admin.findMany({
            where: { id: { in: Array.from(adminIds) } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
      subOrderIds.size > 0
        ? this.prisma.subOrder.findMany({
            where: { id: { in: Array.from(subOrderIds) } },
            select: {
              id: true,
              masterOrderId: true,
              _count: { select: { items: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const sellerById = new Map(sellers.map((s: any) => [s.id, s]));
    const franchiseById = new Map(franchises.map((f: any) => [f.id, f]));
    const adminById = new Map(admins.map((a: any) => [a.id, a]));
    const subOrderById = new Map(
      subOrders.map((s: any) => [s.id, s] as const),
    );

    // Compute per-master sub-order index so the UI can say
    // "Sub-order #2 of 4". We need ALL sub-orders for the master
    // order, not just the ones touched by this log batch. Use the
    // first row to identify the master.
    const masterId = rows[0]!.masterOrderId;
    const masterSubOrders = await this.prisma.subOrder.findMany({
      where: { masterOrderId: masterId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const subOrderIndexByMaster = new Map(
      masterSubOrders.map((s: any, idx: number) => [s.id, idx + 1] as const),
    );

    const resolveNodeName = (
      nodeType: string | null,
      nodeId: string | null,
    ): string | null => {
      if (!nodeId) return null;
      if (nodeType === 'FRANCHISE') {
        const f = franchiseById.get(nodeId) as any;
        return f?.businessName ?? null;
      }
      const s = sellerById.get(nodeId) as any;
      return s?.sellerShopName ?? s?.sellerName ?? null;
    };

    return rows.map((r) => {
      const fromName = resolveNodeName(r.fromNodeType, r.fromNodeId ?? r.fromSellerId);
      const toName = resolveNodeName(r.toNodeType, r.toNodeId ?? r.toSellerId ?? null);
      const reassignerRecord = r.reassignedBy
        ? (adminById.get(r.reassignedBy) as any)
        : null;
      const subOrderInfo = subOrderById.get(r.subOrderId) as any;
      const newSubOrderInfo = r.newSubOrderId
        ? (subOrderById.get(r.newSubOrderId) as any)
        : null;
      return {
        ...r,
        fromName: fromName ?? r.fromNodeId ?? r.fromSellerId,
        toName: toName ?? r.toNodeId ?? r.toSellerId ?? 'N/A',
        // Phase 79 — legacy compat fields kept so the existing UI
        // bindings (fromSellerName/toSellerName) continue to render
        // without an immediate client-side rename.
        fromSellerName: fromName ?? r.fromNodeId ?? r.fromSellerId,
        toSellerName: toName ?? r.toNodeId ?? r.toSellerId ?? 'N/A',
        reassignedByName: reassignerRecord?.name ?? null,
        reassignedByEmail: reassignerRecord?.email ?? null,
        subOrderItemCount: subOrderInfo?._count?.items ?? null,
        subOrderIndex: subOrderIndexByMaster.get(r.subOrderId) ?? null,
        newSubOrderItemCount: newSubOrderInfo?._count?.items ?? null,
        newSubOrderIndex:
          r.newSubOrderId &&
          subOrderIndexByMaster.get(r.newSubOrderId) !== undefined
            ? subOrderIndexByMaster.get(r.newSubOrderId)
            : null,
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Seller-scoped methods
  // ────────────────────────────────────────────────────────────────────────

  async listSellerOrders(
    sellerId: string,
    page: number,
    limit: number,
    filters?: {
      fulfillmentStatus?: string;
      acceptStatus?: string;
      paymentStatus?: string;
      search?: string;
    },
  ) {
    // Sellers should see every order routed to them or beyond — including the
    // multi-seller rollup states (PARTIALLY_SHIPPED / PARTIALLY_DELIVERED /
    // PARTIALLY_CANCELLED) and terminal CANCELLED / EXCEPTION_QUEUE. We DENY
    // only the pre-routing master statuses (which have no seller sub-orders yet
    // anyway) rather than allow-listing, so a newly-added "later" status can
    // never silently hide an order from the seller again.
    //
    // Bug this fixes: the old allow-list was ['ROUTED_TO_SELLER',
    // 'SELLER_ACCEPTED', 'DISPATCHED', 'DELIVERED'] — it omitted
    // PARTIALLY_SHIPPED. A multi-seller order where one seller ships before the
    // other rolls the MASTER to PARTIALLY_SHIPPED, so the order disappeared from
    // BOTH sellers' lists (the detail page still worked — it keys on sub-order
    // id with no master-status filter).
    const preRoutingStatuses = [
      'PENDING_PAYMENT',
      'PLACED',
      'PENDING_VERIFICATION',
      'VERIFIED',
      'REJECTED',
    ] as const;

    const where: Prisma.SubOrderWhereInput = {
      sellerId,
      masterOrder: {
        orderStatus: { notIn: [...preRoutingStatuses] },
      },
    };

    if (filters?.fulfillmentStatus) {
      where.fulfillmentStatus = filters.fulfillmentStatus as any;
    }
    if (filters?.acceptStatus) {
      where.acceptStatus = filters.acceptStatus as any;
    }
    if (filters?.paymentStatus) {
      where.paymentStatus = filters.paymentStatus as any;
    }
    if (filters?.search) {
      where.masterOrder = {
        ...((where.masterOrder as any) || {}),
        orderNumber: {
          contains: filters.search,
          mode: 'insensitive',
        },
      };
    }

    const [subOrders, total] = await Promise.all([
      this.orderRepo.findSellerSubOrders(
        where,
        (page - 1) * limit,
        limit,
      ),
      this.orderRepo.countSellerSubOrders(where),
    ]);
    return {
      subOrders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSellerOrder(id: string, sellerId: string) {
    const subOrder = await this.orderRepo.findSubOrderForSeller(
      id,
      sellerId,
    );
    if (!subOrder) throw new NotFoundAppException('Order not found');
    // Surface the wallet-aware payment label on the master so the seller +
    // seller-admin order views don't render a wallet-paid order as "Cash on
    // Delivery". Derived from the master order's effective tender.
    const master: any = (subOrder as any).masterOrder ?? {};
    return {
      ...subOrder,
      masterOrder: {
        ...master,
        paymentMethodLabel: this.deriveEffectivePaymentLabel(master),
        walletAmountUsedInPaise:
          master.walletAmountUsedInPaise != null
            ? master.walletAmountUsedInPaise.toString()
            : '0',
      },
    };
  }

  async sellerAcceptOrder(
    id: string,
    sellerId: string,
    options?: { expectedDispatchDate?: string },
  ) {
    const subOrder = await this.orderRepo.findSubOrderForSellerBasic(
      id,
      sellerId,
    );
    if (!subOrder) throw new NotFoundAppException('Order not found');

    // Phase 80 (2026-05-22) — acceptance audit Gap #4 + R3. Block
    // late-accepts at the application layer. Pre-Phase-80 a seller
    // could call /accept after acceptDeadlineAt passed; the FSM
    // gate only checks status, so an OPEN-still row went straight
    // to ACCEPTED past its deadline. The SLA cron would have
    // auto-rejected it 60s later but in the race window the order
    // was visibly "accepted past expiry" — customer-visible
    // inconsistency.
    if (
      subOrder.acceptDeadlineAt &&
      new Date() > subOrder.acceptDeadlineAt
    ) {
      throw new BadRequestAppException(
        'Acceptance window has expired — the order has been auto-rejected. Refresh to see the new status.',
      );
    }

    // Phase 80 (2026-05-22) — acceptance audit Gap #17 / R2. CAS in a
    // tx with row-level lock so the seller-accept ↔ cron-auto-reject
    // race serialises. Whichever one acquires the lock first wins;
    // the other one re-reads the row inside the lock and either no-ops
    // (status no longer OPEN) or fails loudly.
    const updated = await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; accept_status: string; accept_deadline_at: Date | null }>
      >`
        SELECT id, accept_status, accept_deadline_at
        FROM sub_orders
        WHERE id = ${id}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundAppException('Order not found');
      }
      // FSM check inside the lock — catches the race where the cron
      // committed a REJECTED state between our snapshot read and the
      // lock acquire.
      assertTransition(
        'OrderAcceptStatus',
        locked.accept_status as any,
        'ACCEPTED',
      );
      // Re-check deadline under lock — same reason.
      if (locked.accept_deadline_at && new Date() > locked.accept_deadline_at) {
        throw new BadRequestAppException(
          'Acceptance window has expired — the order has been auto-rejected. Refresh to see the new status.',
        );
      }
      const now = new Date();
      const updateData: any = {
        acceptStatus: 'ACCEPTED',
        // Phase 80 — Gap #7. Acceptance timestamp + actor.
        acceptedAt: now,
        acceptedBy: sellerId,
      };
      if (options?.expectedDispatchDate) {
        updateData.expectedDispatchDate = new Date(options.expectedDispatchDate);
      }
      const updatedRow = await tx.subOrder.update({
        where: { id },
        data: updateData,
      });

      // Phase 84 (2026-05-23) — timeline event inside the tx.
      // SUBORDER_ACCEPTED is CUSTOMER_VISIBLE by default in the
      // recorder's per-eventType visibility map.
      if (this.timeline) {
        await this.timeline.record(
          {
            masterOrderId: subOrder.masterOrderId,
            subOrderId: id,
            eventType: 'SUBORDER_ACCEPTED',
            oldStatus: 'OPEN',
            newStatus: 'ACCEPTED',
            actorType: 'SELLER',
            actorId: sellerId,
            metadata: {
              expectedDispatchDate:
                options?.expectedDispatchDate ?? null,
            },
          },
          tx,
        );
      }
      return updatedRow;
    });

    // Update master order status to SELLER_ACCEPTED
    await this.orderRepo.updateMasterOrder(subOrder.masterOrderId, {
      orderStatus: 'SELLER_ACCEPTED',
    });

    // Phase 80 — Gap #21. Tamper-evident audit log row for the
    // accept action. The domain-event already broadcasts to the
    // event-log handler (`**`), but the dedicated audit_logs row
    // gives the compliance dashboard a single-table view of every
    // sub-order lifecycle decision.
    await this.auditFacade
      ?.writeAuditLog({
        actorId: sellerId,
        actorRole: 'SELLER',
        action: 'SUB_ORDER_ACCEPTED',
        module: 'orders',
        resource: 'SubOrder',
        resourceId: id,
        oldValue: { acceptStatus: 'OPEN' },
        newValue: {
          acceptStatus: 'ACCEPTED',
          acceptedAt: (updated as any).acceptedAt,
          expectedDispatchDate: (updated as any).expectedDispatchDate ?? null,
        },
      })
      .catch((err) =>
        this.logger.error(
          `Failed to write audit log for sub-order accept ${id}: ${
            (err as Error).message
          }`,
        ),
      );

    // Phase 2 / H6 — broadcast acceptance so the notifications +
    // audit + downstream subscribers can react. Best-effort: if the
    // event bus is misbehaving, the order's own state change has
    // already been committed and the customer can still see the
    // accept in their order detail page; the missed notification
    // is recoverable via outbox replay.
    await this.eventBus
      .publish({
        eventName: 'orders.sub_order.accepted',
        aggregate: 'SubOrder',
        aggregateId: id,
        occurredAt: new Date(),
        payload: {
          subOrderId: id,
          masterOrderId: subOrder.masterOrderId,
          sellerId,
          acceptedBy: sellerId,
          expectedDispatchDate:
            options?.expectedDispatchDate ?? null,
        },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to publish orders.sub_order.accepted for ${id}: ${(err as Error).message}`,
        );
      });

    // Fire-and-forget invoice generation. Tax mode (OFF/AUDIT/STRICT) is
    // enforced inside the facade/service — in OFF the call no-ops, in
    // AUDIT/STRICT it issues a TAX_INVOICE (or BILL_OF_SUPPLY for unreg
    // suppliers) plus, downstream, an e_way_bills row when consignment
    // crosses the threshold. Errors are logged but never block the
    // seller's accept response. Idempotent — duplicate calls return the
    // existing invoice.
    await this.taxFacade.generateInvoiceForSubOrder(id);

    return updated;
  }

  // T5: Seller reject with reassignment logic
  //
  // Phase 80 (2026-05-22) — acceptance audit Gaps #6/#7/#17/#19/#21.
  //   • `auto` option discriminates the cron-driven path (Gap #19).
  //     When true, rejectionType=AUTO_SLA, autoRejectedAt=now, and
  //     rejectionReason is normalised to a non-enum sentinel that
  //     the analytics dashboard recognises. When false (default),
  //     rejectionType=MANUAL and the actor id is stored as rejectedBy.
  //   • SELECT FOR UPDATE inside a tx so the seller-reject ↔
  //     cron-auto-reject ↔ seller-accept race serialises (Gap #17).
  //   • Audit log row per transition (Gap #21).
  async sellerRejectOrder(
    id: string,
    sellerId: string,
    options?: { reason?: string; note?: string; auto?: boolean },
  ) {
    const subOrder =
      await this.orderRepo.findSubOrderForSellerWithDetails(
        id,
        sellerId,
      );
    if (!subOrder) throw new NotFoundAppException('Order not found');
    const isAuto = !!options?.auto;

    // Phase 80 — Gap #17 / R2. Lock the row + re-check FSM under lock
    // so concurrent accept/reject/cron paths serialise. The cron's
    // auto-reject and the seller's manual reject can both target the
    // same row in the same second; whichever one wins the lock
    // transitions the FSM, the loser sees REJECTED at re-read and
    // bails cleanly.
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; accept_status: string }>
      >`
        SELECT id, accept_status
        FROM sub_orders
        WHERE id = ${id}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundAppException('Order not found');
      }
      // FSM under lock — if a parallel accept won, the FSM rejects
      // the OPEN→REJECTED transition with a clear error message.
      assertTransition(
        'OrderAcceptStatus',
        locked.accept_status as any,
        'REJECTED',
      );

      await tx.subOrder.update({
        where: { id },
        data: {
          acceptStatus: 'REJECTED',
          fulfillmentStatus: 'CANCELLED',
          rejectionReason: options?.reason || null,
          rejectionNote: options?.note || null,
          // Phase 80 — Gap #7/#19 audit columns.
          rejectedAt: now,
          // For auto-rejects there's no human actor — the cron is the
          // system actor. We store the seller id so the row still
          // identifies the affected seller.
          rejectedBy: sellerId,
          rejectionType: isAuto ? 'AUTO_SLA' : 'MANUAL',
          autoRejectedAt: isAuto ? now : null,
        } as any,
      });

      // Phase 84 (2026-05-23) — timeline event inside the tx.
      if (this.timeline) {
        await this.timeline.record(
          {
            masterOrderId: subOrder.masterOrder.id,
            subOrderId: id,
            eventType: isAuto
              ? 'SUBORDER_REJECTED_AUTO_SLA'
              : 'SUBORDER_REJECTED_MANUAL',
            oldStatus: 'OPEN',
            newStatus: 'REJECTED',
            actorType: isAuto ? 'SYSTEM' : 'SELLER',
            actorId: isAuto ? null : sellerId,
            reason: options?.reason || null,
            note: options?.note || null,
          },
          tx,
        );
      }
    });

    // Phase 80 — Gap #21. Audit log row (separate from the domain
    // event-log handler) so compliance can query a single table for
    // all sub-order lifecycle decisions.
    await this.auditFacade
      ?.writeAuditLog({
        actorId: isAuto ? null : sellerId,
        actorRole: isAuto ? 'SYSTEM' : 'SELLER',
        action: isAuto ? 'SUB_ORDER_AUTO_REJECTED' : 'SUB_ORDER_REJECTED',
        module: 'orders',
        resource: 'SubOrder',
        resourceId: id,
        oldValue: { acceptStatus: 'OPEN' },
        newValue: {
          acceptStatus: 'REJECTED',
          rejectionType: isAuto ? 'AUTO_SLA' : 'MANUAL',
          rejectionReason: options?.reason || null,
          rejectionNote: options?.note || null,
          rejectedAt: now,
        },
      } as any)
      .catch((err) =>
        this.logger.error(
          `Failed to write audit log for sub-order reject ${id}: ${
            (err as Error).message
          }`,
        ),
      );

    // Restore stock for the rejected seller's confirmed reservations
    const rejectedReservations =
      await this.orderRepo.findStockReservations(
        subOrder.masterOrder.id,
        sellerId,
      );

    for (const res of rejectedReservations) {
      if (res.status === 'CONFIRMED') {
        await this.orderRepo.restoreStockFromConfirmedReservation(
          res.id,
          res.mappingId,
          res.quantity,
        );
      } else if (res.status === 'RESERVED') {
        await this.orderRepo.releaseReservedStock(
          res.id,
          res.mappingId,
          res.quantity,
        );
      }
    }

    // T5: Attempt reassignment for each item
    const addressSnapshot =
      subOrder.masterOrder.shippingAddressSnapshot as any;
    const customerPincode = addressSnapshot?.postalCode;

    let reassignmentSuccessful = false;
    let newSubOrderId: string | null = null;
    let newSellerId: string | null = null;

    if (customerPincode) {
      try {
        // Find ALL sellers who have already rejected this master order
        const previousRejections =
          await this.orderRepo.findSubOrdersByMasterOrder(
            subOrder.masterOrder.id,
          );
        const rejectedSellerIds = new Set(
          previousRejections
            .filter((r: any) => r.acceptStatus === 'REJECTED')
            .map((r: any) => r.sellerId),
        );
        rejectedSellerIds.add(sellerId);

        // Find all mapping IDs belonging to rejected sellers for this product
        const rejectedMappingIds: string[] = [];
        for (const item of subOrder.items) {
          const ids =
            await this.orderRepo.findSellerProductMappingIds(
              item.productId,
              item.variantId,
              Array.from(rejectedSellerIds),
            );
          rejectedMappingIds.push(...ids);
        }

        // Group items by productId/variantId for reallocation
        for (const item of subOrder.items) {
          // Use the combined allocate+reserve so primary→secondary→tertiary
          // fallback kicks in if a higher-ranked candidate loses a
          // concurrent reservation race. The reassign path is exactly the
          // case where stale `available` snapshots burn customers.
          let allocateReserve;
          try {
            allocateReserve =
              await this.catalogFacade.allocateAndReserve({
                productId: item.productId,
                variantId: item.variantId ?? undefined,
                customerPincode,
                quantity: item.quantity,
                excludeMappingIds: rejectedMappingIds,
                orderId: subOrder.masterOrder.id,
                expiresInMinutes: 60,
              });
          } catch {
            // No candidate could satisfy this item — leave reassignment
            // failed so the outer loop falls through to the manual queue.
            allocateReserve = null;
          }

          if (allocateReserve) {
            const reservation = allocateReserve.reservation;
            const chosen = allocateReserve.chosenCandidate;

            // Confirm reservation immediately since order already exists
            await this.catalogFacade.confirmReservation(
              reservation.id,
              subOrder.masterOrder.id,
            );

            // Create new sub-order for the new seller
            const acceptDeadlineAt = new Date(
              Date.now() + this.acceptDeadlineMs(),
            );
            const newSubOrder =
              await this.orderRepo.createSubOrder({
                masterOrderId: subOrder.masterOrder.id,
                sellerId: chosen.sellerId,
                subTotal: Number(item.totalPrice),
                paymentStatus: subOrder.paymentStatus,
                fulfillmentStatus: 'UNFULFILLED',
                acceptStatus: 'OPEN',
                acceptDeadlineAt,
                items: {
                  create: {
                    productId: item.productId,
                    variantId: item.variantId,
                    productTitle: item.productTitle,
                    variantTitle: item.variantTitle,
                    sku: item.sku,
                    masterSku:
                      (item as any).masterSku || item.sku,
                    imageUrl: item.imageUrl,
                    unitPrice: item.unitPrice,
                    quantity: item.quantity,
                    totalPrice: item.totalPrice,
                  },
                },
              });

            reassignmentSuccessful = true;
            newSubOrderId = newSubOrder.id;
            newSellerId = chosen.sellerId;

            // Publish event for new seller notification
            await this.eventBus.publish({
              eventName: 'orders.sub_order.created',
              aggregate: 'SubOrder',
              aggregateId: newSubOrder.id,
              occurredAt: new Date(),
              payload: {
                subOrderId: newSubOrder.id,
                masterOrderId: subOrder.masterOrder.id,
                orderNumber: subOrder.masterOrder.orderNumber,
                sellerId: chosen.sellerId,
                sellerName: chosen.sellerName,
                subTotal: Number(item.totalPrice),
                itemCount: item.quantity,
                isReassignment: true,
              },
            });
          }
        }
      } catch {
        // Reassignment failed — continue with cancellation below
      }
    }

    // If no reassignment was possible, move master order to EXCEPTION_QUEUE
    if (!reassignmentSuccessful) {
      await this.orderRepo.updateMasterOrder(subOrder.masterOrder.id, {
        orderStatus: 'EXCEPTION_QUEUE',
      });

      // Publish exception event for admin notification
      await this.eventBus.publish({
        eventName: 'orders.master.exception',
        aggregate: 'MasterOrder',
        aggregateId: subOrder.masterOrder.id,
        occurredAt: new Date(),
        payload: {
          masterOrderId: subOrder.masterOrder.id,
          orderNumber: subOrder.masterOrder.orderNumber,
          customerId: subOrder.masterOrder.customerId,
          orderStatus: 'EXCEPTION_QUEUE',
          reason:
            'Seller rejected and no alternative seller available — awaiting manual reassignment',
          rejectedSubOrderId: id,
          rejectedSellerId: sellerId,
        },
      });
    }

    // Phase 79 (2026-05-22) — history audit Gaps #4/#6/#12.
    //   • Removed the `.catch(() => {})` swallow that pre-Phase-79
    //     could silently drop the log row on a DB hiccup (Gap #4).
    //     Auto-cascade still continues; the log write is now a
    //     loud failure that surfaces in the existing exception
    //     handler.
    //   • eventType: AUTO_AFTER_SELLER_REJECT — the UI badges this
    //     differently from an admin manual reassign (Gap #6).
    //   • failureReason: populated when the cascade couldn't place
    //     the order on any candidate (Gap #12). Pre-Phase-79 the
    //     UI showed the seller's rejection reason as if it were the
    //     reassignment failure reason.
    //   • Populates the new fromNodeType/toNodeType discriminators
    //     so the read path doesn't fall back to "SELLER" defaults.
    const previousSubOrderRejection = options?.reason ?? null;
    await this.orderRepo.createReassignmentLog({
      subOrderId: id,
      masterOrderId: subOrder.masterOrder.id,
      fromNodeType: 'SELLER',
      fromNodeId: sellerId,
      toNodeType: 'SELLER',
      toNodeId: newSellerId,
      fromSellerId: sellerId,
      toSellerId: newSellerId,
      reason: previousSubOrderRejection
        ? `Seller rejected the order: ${previousSubOrderRejection}`
        : 'Seller rejected the order',
      successful: reassignmentSuccessful,
      failureReason: reassignmentSuccessful
        ? null
        : customerPincode
          ? 'Auto-reassignment found no eligible alternate seller at this pincode'
          : 'Auto-reassignment could not run — shipping pincode missing from address snapshot',
      newSubOrderId,
      reassignedBy: null,
      eventType: 'AUTO_AFTER_SELLER_REJECT',
    });

    // Phase 4.3 (2026-05-16) — discount reversal trigger.
    //
    // The rejected sub-order's items either move to a new seller
    // (reassignmentSuccessful) or get held in EXCEPTION_QUEUE for
    // manual handling. In BOTH cases the discount that was originally
    // allocated to those items must be recomputed: the new seller's
    // settlement should carry the right discount share, OR — if no
    // reassignment — the customer must be partially refunded for the
    // discount-bearing items that won't fulfil.
    //
    // We emit a dedicated event so the discounts module owns the
    // recalc logic and we don't couple orders.service to the
    // discount allocation internals. A handler in the discounts
    // module listens, walks OrderItemDiscounts for the rejected
    // sub-order, and either transfers the allocation (reassignment)
    // or reverses it (exception queue).
    await this.eventBus
      .publish({
        eventName: 'orders.sub_order.rejected_needs_discount_recalc',
        aggregate: 'SubOrder',
        aggregateId: id,
        occurredAt: new Date(),
        payload: {
          rejectedSubOrderId: id,
          masterOrderId: subOrder.masterOrder.id,
          fromSellerId: sellerId,
          reassigned: reassignmentSuccessful,
          newSubOrderId,
          newSellerId,
          itemIds: subOrder.items.map((it: any) => it.id),
        },
      })
      .catch(() => {
        /* best-effort — event handler will pick up via the audit log fallback */
      });

    return {
      rejected: true,
      reassigned: reassignmentSuccessful,
      newSubOrderId,
      message: reassignmentSuccessful
        ? 'Order rejected and reassigned to another seller'
        : 'Order rejected — no alternative seller available, moved to exception queue for manual reassignment',
    };
  }

  // T4: Update fulfillment status (PACKED, SHIPPED, etc.)
  //
  // Phase 82 (2026-05-23) — packing & shipping audit. Closes:
  //   • Gap #1   — packedAt/By + shippedAt/By stamped on the row.
  //   • Gap #5   — audit_log row written for every transition.
  //   • Gap #10  — trackingUrl derived from courier+AWB at SHIPPED.
  //   • Gap #12  — master rollup: PARTIALLY_SHIPPED when some shipped,
  //                DISPATCHED when all active sub-orders shipped.
  //   • Gap #15  — single tx wraps sub-order update + master rollup +
  //                audit log + outbox event publish.
  //   • Gap #18  — SELECT FOR UPDATE on the sub-order row closes the
  //                pack-vs-cancel race window.
  //   • Gap #20  — SHIPMENT_EVIDENCE_REQUIRED env-driven.
  async sellerUpdateFulfillmentStatus(
    id: string,
    sellerId: string,
    status: string,
    extra?: { trackingNumber?: string; courierName?: string },
  ) {
    return this.updateFulfillmentStatusInternal({
      subOrderId: id,
      actorId: sellerId,
      actorKind: 'SELLER',
      status,
      extra,
      ownershipCheck: async () =>
        this.orderRepo.findSubOrderForSellerBasic(id, sellerId),
    });
  }

  /**
   * Phase 82 — unified fulfillment-status writer. Replaces the
   * seller / franchise divergence. Both actors share:
   *   • FSM-enforced transitions (UNFULFILLED → PACKED → SHIPPED).
   *   • Mandatory trackingNumber + courierName at SHIPPED.
   *   • 4-photo evidence gate at SHIPPED (env-tunable).
   *   • packedAt/By + shippedAt/By stamping.
   *   • Tax invoice trigger at SHIPPED.
   *   • Master order rollup.
   *   • Audit log row.
   *   • Customer notification event.
   *
   * The franchise method (FranchiseOrdersService.updateFulfillmentStatus)
   * delegates to this same path via FranchiseFulfillmentBridge below.
   */
  async updateFulfillmentStatusInternal(args: {
    subOrderId: string;
    actorId: string;
    actorKind: 'SELLER' | 'FRANCHISE';
    status: string;
    extra?: { trackingNumber?: string; courierName?: string };
    ownershipCheck: () => Promise<any | null>;
  }) {
    const { subOrderId, actorId, actorKind, status, extra } = args;
    const subOrder = await args.ownershipCheck();
    if (!subOrder) throw new NotFoundAppException('Order not found');
    if (subOrder.acceptStatus !== 'ACCEPTED') {
      throw new BadRequestAppException(
        'Order must be accepted before updating fulfillment status',
      );
    }

    // Pre-tx FSM gate. Hardcoded map gives a friendlier error for the
    // common typos (FULFILLED / DELIVERED) than the generic FSM
    // assertion. The full assertTransition runs INSIDE the tx after
    // the FOR UPDATE so a concurrent cancel can't sneak past.
    const allowedTransitions: Record<string, string[]> = {
      UNFULFILLED: ['PACKED'],
      PACKED: ['SHIPPED'],
    };
    const allowed = allowedTransitions[subOrder.fulfillmentStatus] || [];
    if (!allowed.includes(status)) {
      if (status === 'DELIVERED') {
        throw new BadRequestAppException(
          'Delivery must be confirmed by admin. Seller/franchise can only update status up to SHIPPED.',
        );
      }
      if (status === 'FULFILLED') {
        throw new BadRequestAppException(
          'FULFILLED status is deprecated. Use PACKED → SHIPPED flow instead.',
        );
      }
      throw new BadRequestAppException(
        `Cannot transition from ${subOrder.fulfillmentStatus} to ${status}. Allowed: ${allowed.join(', ') || 'none (flow complete)'}`,
      );
    }

    // At SHIPPED — required-field + evidence guards before entering tx.
    let trackingNumber: string | undefined;
    let courierName: string | undefined;
    let trackingUrl: string | null = null;
    if (status === 'SHIPPED') {
      trackingNumber = extra?.trackingNumber?.trim();
      courierName = extra?.courierName?.trim();
      if (!trackingNumber || !courierName) {
        throw new BadRequestAppException(
          'trackingNumber and courierName are required when marking an order as SHIPPED',
        );
      }
      // Phase 88 (2026-05-23) — Gap #16. Evidence count moved INSIDE
      // the FOR UPDATE tx below to close the TOCTOU race window
      // between the count check and the SHIPPED transition. The
      // pre-check here is removed.
      //
      // Phase 82 — Gap #10. Derive trackingUrl from the courier
      // mapping. Returns null for OTHER / unmapped — caller stores
      // null and customer view falls back to showing the raw AWB.
      const {
        buildTrackingUrl,
      } = require('../../presentation/dtos/update-fulfillment-status.dto');
      trackingUrl = buildTrackingUrl(courierName, trackingNumber);
    }

    const now = new Date();
    const previousFulfillmentStatus = subOrder.fulfillmentStatus;
    let newMasterStatus: string | null = null;

    // Phase 82 — Gap #15/#18. Single tx wraps:
    //   1. FOR UPDATE row lock
    //   2. FSM assertTransition under the lock
    //   3. Sub-order update with audit columns
    //   4. Master rollup (PARTIALLY_SHIPPED / DISPATCHED)
    //   5. Audit log
    //   6. Outbox-aware event publish
    const updated = await this.orderRepo.executeTransaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          fulfillment_status: string;
          accept_status: string;
          delivery_method: string | null;
        }>
      >`
        SELECT id, fulfillment_status, accept_status, delivery_method
        FROM sub_orders
        WHERE id = ${subOrderId}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundAppException('Sub-order disappeared mid-tx');
      }
      if (locked.accept_status !== 'ACCEPTED') {
        throw new ConflictAppException(
          'Sub-order state changed under lock — refresh and try again',
        );
      }
      // FSM under lock — catches concurrent cancel / status update.
      assertTransition(
        'OrderFulfillmentStatus',
        locked.fulfillment_status as any,
        status,
      );

      // Phase 88 (2026-05-23) — Gap #16 TOCTOU close. Count gate
      // runs UNDER the FOR UPDATE lock so a sibling soft-delete or
      // upload can't slip past during the check-then-act window.
      // Reads from the typed ShipmentEvidence table (PACKING kind
      // only — the audit's Gap #2 motivation).
      if (status === 'SHIPPED' && this.ewayBill) {
        // Phase 89 (2026-05-23) — Gap #4. EWB compliance gate. Runs
        // INSIDE the FOR UPDATE tx so a concurrent classify / cancel
        // can't slip past. canShip returns allowed=false for
        // REQUIRED / PENDING / FAILED / EXPIRED rows without an
        // active OVERRIDDEN; throws a 4xx so the seller surface
        // shows a clear "E-way bill required" message rather than
        // a generic 500.
        const decision = await this.ewayBill.canShip(subOrderId);
        if (!decision.allowed) {
          throw new BadRequestAppException(
            `Cannot ship: ${decision.reason}`,
          );
        }
      }

      // Shipment-evidence gate.
      //   • Non-Delhivery: enforced at the manual SHIPPED step (the seller
      //     clicks "Mark as Shipped").
      //   • Delhivery (SELLER/RETAIL/FRANCHISE): there is NO manual ship —
      //     marking PACKED auto-books + auto-ships the parcel — so the 4 photos
      //     are required at PACKED instead, guaranteeing dispatch evidence
      //     exists BEFORE the parcel leaves. Franchises now have their own
      //     shipment-evidence upload surface (FranchiseShipmentEvidenceController
      //     + the franchise order-page uploader), so the gate applies to both
      //     SELLER and FRANCHISE actors — gating their PACK no longer locks
      //     them out.
      const isDelhiveryNode = locked.delivery_method === 'DELHIVERY';
      const requiresEvidence =
        status === 'SHIPPED' ||
        (status === 'PACKED' &&
          isDelhiveryNode &&
          (actorKind === 'SELLER' || actorKind === 'FRANCHISE'));
      if (requiresEvidence) {
        const evidenceRequired = this.env.getNumber(
          'SHIPMENT_EVIDENCE_REQUIRED_PHOTOS',
          SHIPMENT_EVIDENCE_REQUIRED_FALLBACK,
        );
        // Phase 88 — typed-path read. Fallback to the legacy
        // FileAttachment count when the typed-evidence service
        // isn't wired (test harness / partial-DI environments).
        const evidenceCount = this.shipmentEvidence
          ? await this.shipmentEvidence.countPackingForGate(
              subOrderId,
              tx as any,
            )
          : await (tx as any).fileAttachment.count({
              where: {
                resource: 'sub_order',
                resourceId: subOrderId,
                file: { purpose: 'SHIPMENT_EVIDENCE', deletedAt: null },
              },
            });
        if (evidenceCount < evidenceRequired) {
          throw new BadRequestAppException(
            status === 'PACKED'
              ? `At least ${evidenceRequired} shipment evidence photos must be uploaded before marking this Delhivery order as PACKED — it auto-ships on pack, so the dispatch photos are required first. Current: ${evidenceCount}.`
              : `At least ${evidenceRequired} shipment evidence photos must be uploaded before marking as SHIPPED. Current: ${evidenceCount}.`,
          );
        }
      }

      const updateData: any = { fulfillmentStatus: status };
      if (status === 'PACKED') {
        updateData.packedAt = now;
        updateData.packedBy = actorId;
      }
      if (status === 'SHIPPED') {
        updateData.shippedAt = now;
        updateData.shippedBy = actorId;
        updateData.trackingNumber = trackingNumber;
        updateData.courierName = courierName;
        updateData.trackingUrl = trackingUrl;
        // Ensure packedAt is at least set — covers the legacy /
        // backfill case where the row never went through a PACKED
        // transition with the audit column populated.
        if (!subOrder.packedAt) {
          updateData.packedAt = now;
          updateData.packedBy = actorId;
        }
      }

      const updatedRow = await tx.subOrder.update({
        where: { id: subOrderId },
        data: updateData,
      });

      // Phase 88 — Gap #13 freeze. At the PACKED → SHIPPED
      // transition, stamp `frozenAt` on every PACKING evidence row
      // so seller cannot soft-delete + re-upload post-ship to
      // tamper with the dispatch baseline.
      if (status === 'SHIPPED' && this.shipmentEvidence) {
        await this.shipmentEvidence.freezePackingEvidence(
          subOrderId,
          tx as any,
        );
      }

      // Master rollup (Gap #12). Read every active sibling and
      // decide if master should flip to PARTIALLY_SHIPPED or
      // DISPATCHED. Skip for PACKED transitions (master only
      // advances when at least one sub-order is SHIPPED).
      if (status === 'SHIPPED') {
        const siblings = await tx.subOrder.findMany({
          where: { masterOrderId: subOrder.masterOrderId },
          select: { id: true, fulfillmentStatus: true, acceptStatus: true },
        });
        // "Active" = anything not rejected (rejected sub-orders
        // shouldn't gate the rollup — they're already terminal).
        const active = siblings.filter(
          (s: any) => s.acceptStatus !== 'REJECTED',
        );
        const shippedOrLater = active.filter((s: any) =>
          ['SHIPPED', 'DELIVERED'].includes(s.fulfillmentStatus),
        );
        if (shippedOrLater.length === active.length && active.length > 0) {
          newMasterStatus = 'DISPATCHED';
        } else if (shippedOrLater.length > 0) {
          newMasterStatus = 'PARTIALLY_SHIPPED';
        }
        if (newMasterStatus) {
          const master = await tx.masterOrder.findUnique({
            where: { id: subOrder.masterOrderId },
            select: { orderStatus: true },
          });
          if (
            master &&
            master.orderStatus !== newMasterStatus &&
            isTransitionAllowed(
              'OrderStatus',
              master.orderStatus as any,
              newMasterStatus as any,
            )
          ) {
            await tx.masterOrder.update({
              where: { id: subOrder.masterOrderId },
              data: { orderStatus: newMasterStatus as any },
            });
          } else {
            // FSM blocks the transition — log and leave master
            // unchanged. The sub-order update still commits.
            newMasterStatus = null;
          }
        }
      }

      // Phase 82 — Gap #5. Audit log inside the tx so it commits
      // atomically with the status flip. Best-effort `.catch()`
      // pattern from other writers (e.g. cancel) is intentionally
      // *not* applied — a logging failure means we don't have the
      // audit trail; rolling back is the safer choice.
      if (this.auditFacade) {
        await this.auditFacade.writeAuditLog({
          actorId,
          actorRole: actorKind,
          action: status === 'PACKED' ? 'SUB_ORDER_PACKED' : 'SUB_ORDER_SHIPPED',
          module: 'orders',
          resource: 'SubOrder',
          resourceId: subOrderId,
          oldValue: {
            fulfillmentStatus: previousFulfillmentStatus,
          },
          newValue: {
            fulfillmentStatus: status,
            ...(status === 'PACKED' ? { packedAt: now } : {}),
            ...(status === 'SHIPPED'
              ? {
                  shippedAt: now,
                  trackingNumber,
                  courierName,
                  trackingUrl,
                }
              : {}),
          },
        } as any);
      }

      // Phase 84 (2026-05-23) — timeline event inside the tx.
      // Master rollup PARTIALLY_SHIPPED / DISPATCHED also recorded
      // when applicable so the chronology stays complete.
      if (this.timeline) {
        await this.timeline.record(
          {
            masterOrderId: subOrder.masterOrderId,
            subOrderId,
            eventType: status === 'PACKED' ? 'SUBORDER_PACKED' : 'SUBORDER_SHIPPED',
            oldStatus: previousFulfillmentStatus,
            newStatus: status,
            actorType: actorKind,
            actorId,
            metadata: status === 'SHIPPED' ? {
              trackingNumber,
              courierName,
              trackingUrl,
            } : null,
          },
          tx,
        );
        if (newMasterStatus && status === 'SHIPPED') {
          await this.timeline.record(
            {
              masterOrderId: subOrder.masterOrderId,
              eventType:
                newMasterStatus === 'DISPATCHED'
                  ? 'ORDER_ROUTED_TO_SELLER'
                  : 'ORDER_PARTIALLY_SHIPPED',
              newStatus: newMasterStatus,
              actorType: 'SYSTEM',
            },
            tx,
          );
        }
      }

      // Outbox-aware publish — atomic with the writes when
      // OUTBOX_DUAL_WRITE is on. Customer notification subscriber
      // (Gap #16) consumes this.
      await this.eventBus.publish(
        {
          eventName: 'orders.sub_order.status_changed',
          aggregate: 'SubOrder',
          aggregateId: subOrderId,
          occurredAt: now,
          payload: {
            subOrderId,
            masterOrderId: subOrder.masterOrderId,
            sellerId: actorKind === 'SELLER' ? actorId : null,
            franchiseId: actorKind === 'FRANCHISE' ? actorId : null,
            actorKind,
            previousStatus: previousFulfillmentStatus,
            newStatus: status,
            trackingNumber: trackingNumber ?? null,
            courierName: courierName ?? null,
            trackingUrl,
            newMasterStatus,
          },
        },
        { tx },
      );

      return updatedRow;
    });

    // Post-tx: tax invoice for SHIPPED. Fire-and-forget — failure
    // logged but doesn't roll back the dispatch (the order is
    // already in transit at this point; invoice can be re-issued).
    if (status === 'SHIPPED') {
      await this.taxFacade.generateInvoiceForSubOrder(subOrderId);
    }

    return updated;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Customer-scoped methods
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Map an OrderStatus enum value to a customer-friendly label.
   */
  private mapOrderStatusLabel(status: string): string {
    return ORDER_STATUS_LABELS[status] || status;
  }

  /**
   * Customer-facing status derivation. The master OrderStatus enum has no
   * PACKED stage (packed lives on the sub-order's fulfillmentStatus), so a
   * packed-but-not-yet-shipped order would otherwise read "Confirmed" to the
   * customer while the seller portal shows "Packed". Surface PACKED when a
   * shipment is packed and the order hasn't advanced to DISPATCHED/DELIVERED.
   */
  private deriveCustomerOrderStatus(
    masterStatus: string,
    subOrders: Array<{ fulfillmentStatus?: string }> = [],
  ): string {
    const beyondPacked = ['DISPATCHED', 'DELIVERED', 'CANCELLED'];
    if (
      !beyondPacked.includes(masterStatus) &&
      subOrders.some((so) => so.fulfillmentStatus === 'PACKED')
    ) {
      return 'PACKED';
    }
    return masterStatus;
  }

  async listCustomerOrders(
    customerId: string,
    page: number,
    limit: number,
    // Phase 197 (My-Orders audit #7) — server-side status bucket.
    bucket: 'all' | 'active' | 'delivered' | 'cancelled' = 'all',
  ) {
    const [orders, total, bucketCounts] = await Promise.all([
      this.orderRepo.findCustomerOrders(
        customerId,
        (page - 1) * limit,
        limit,
        bucket,
      ),
      this.orderRepo.countCustomerOrders(customerId, bucket),
      this.orderRepo.countCustomerOrdersByBucket(customerId),
    ]);

    // Strip seller information — customers should not see seller names
    // Add customer-friendly status labels
    // We DO surface deliveryMethod + tracking URL since customers
    // benefit from knowing how the order is being delivered and where
    // to click for live tracking.
    // Derived status (mobile branch) — surfaces a customer-friendly
    // rollup of the sub-order fulfillment states. iThink fields removed
    // per Phase 159 (2026-05-27) — SELF_DELIVERY is the only courier
    // now; courier-agnostic skeleton stays for a future carrier.
    const sanitized = orders.map((o: any) => {
      const derivedStatus = this.deriveCustomerOrderStatus(
        o.orderStatus,
        o.subOrders,
      );
      // Phase 197 (My-Orders audit #1/#2) — explicit customer-safe
      // whitelist. The previous `...o` spread leaked every internal
      // MasterOrder column (verificationRiskScore/Band/Reasons,
      // claimedByAdminId/claimedAt/claimExpiresAt, verifiedBy,
      // selectedTaxProfileId, razorpayOrderId/razorpayPaymentId,
      // paymentExpiresAt, lastPaymentFailure*, sourceCartSnapshot, …)
      // straight to the buyer. Build the response field-by-field
      // instead so a future MasterOrder column can't silently leak.
      return {
        ...this.toCustomerSafeMasterOrder(o),
        orderStatus: derivedStatus,
        orderStatusLabel: this.mapOrderStatusLabel(derivedStatus),
        subOrders: o.subOrders.map((so: any) =>
          this.toCustomerSafeSubOrder(so),
        ),
      };
    });

    return {
      orders: sanitized,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        // Phase 197 (My-Orders audit #7) — the active filter + accurate
        // per-bucket counts so the storefront tab badges are correct on
        // any page (previously computed client-side from one page only).
        status: bucket,
        counts: bucketCounts,
      },
    };
  }

  async getCustomerOrder(customerId: string, orderNumber: string) {
    const order = await this.orderRepo.findMasterOrderByCustomer(
      orderNumber,
      customerId,
    );

    if (!order) throw new NotFoundAppException('Order not found');

    // Phase 26 GST — customer-facing per-item tax snapshot + roll-up.
    // The internal admin response carries the full discount/liability
    // breakdown; the customer sees just the tax bits (no funding split).
    // Empty array for legacy orders without an allocation snapshot.
    const taxSnapshots = await this.prisma.orderItemTaxSnapshot.findMany({
      where: { masterOrderId: order.id },
      select: {
        orderItemId: true,
        grossLineAmountInPaise: true,
        discountAmountInPaise: true,
        taxableAmountInPaise: true,
        gstRateBps: true,
        cgstAmountInPaise: true,
        sgstAmountInPaise: true,
        igstAmountInPaise: true,
        totalTaxAmountInPaise: true,
      },
    });
    const taxSummary = taxSnapshots.reduce(
      (acc, t) => {
        acc.taxableInPaise += BigInt(t.taxableAmountInPaise);
        acc.cgstInPaise += BigInt(t.cgstAmountInPaise);
        acc.sgstInPaise += BigInt(t.sgstAmountInPaise);
        acc.igstInPaise += BigInt(t.igstAmountInPaise);
        acc.totalTaxInPaise += BigInt(t.totalTaxAmountInPaise);
        return acc;
      },
      {
        taxableInPaise: 0n,
        cgstInPaise: 0n,
        sgstInPaise: 0n,
        igstInPaise: 0n,
        totalTaxInPaise: 0n,
      },
    );

    // Phase D — surface the applied coupon to the customer detail page
    // (code + savings). Pull the REDEEMED redemption row for this order;
    // legacy orders without a redemption fall through with a null
    // appliedDiscount.
    let appliedDiscount: {
      code: string | null;
      title: string | null;
      discountAmount: string;
    } | null = null;
    try {
      const redemption = await this.prisma.discountRedemption.findFirst({
        where: {
          masterOrderId: order.id,
          status: 'REDEEMED' as any,
        },
        select: {
          discountAmountInPaise: true,
          discount: { select: { code: true, title: true } },
        },
      });
      if (redemption?.discount) {
        appliedDiscount = {
          code: redemption.discount.code,
          title: redemption.discount.title,
          discountAmount: (Number(redemption.discountAmountInPaise) / 100).toFixed(2),
        };
      } else if (
        order.discountAmountInPaise &&
        BigInt(order.discountAmountInPaise) > 0n
      ) {
        // Legacy fallback — the order has a discount but no redemption
        // row (pre-Phase-B). Surface the amount with no code.
        appliedDiscount = {
          code: null,
          title: null,
          discountAmount: (Number(order.discountAmountInPaise) / 100).toFixed(2),
        };
      }
    } catch {
      // Best-effort — never block the order page on the redemption lookup.
    }

    // Shipping snapshot (v1) — surfaces the fee on customer order detail.
    // Returns null when no shipping option was attached (legacy / free orders).
    const shipping =
      order.shippingFeeInPaise && BigInt(order.shippingFeeInPaise) > 0n
        ? {
            optionName: order.shippingOptionName,
            feeInPaise: order.shippingFeeInPaise.toString(),
            feeInRupees: (Number(order.shippingFeeInPaise) / 100).toFixed(2),
          }
        : null;

    // Sprint 3 Story 2.5 — synthesized buyer timeline.
    //
    // No dedicated order_status_history table exists yet; the timeline
    // is composed from the timestamps the order/sub-order rows already
    // carry. Only events with a real timestamp are emitted — "what's
    // next" projections are the frontend's concern.
    //
    // Each entry: { kind, label, at, subOrderId? }
    //   - kind: stable enum-like string the FE can switch on for
    //     icons / colours. Don't render the label as a fallback.
    //   - label: humanised English copy — small enough to inline; if
    //     we ever localise, move to i18n keys here.
    //   - at: ISO datetime (or null for projected; today we don't
    //     emit projected).
    //   - subOrderId: present for per-sub-order events so the FE can
    //     scope the entry to a particular shipment in the UI.
    type TimelineEvent = {
      kind: string;
      label: string;
      at: Date;
      subOrderId?: string;
    };
    const timeline: TimelineEvent[] = [];
    timeline.push({
      kind: 'ORDER_PLACED',
      label: 'Order placed',
      at: order.createdAt,
    });
    if (order.verifiedAt) {
      timeline.push({
        kind: 'ORDER_VERIFIED',
        label: 'Order verified',
        at: order.verifiedAt,
      });
    }
    for (const so of order.subOrders) {
      if (so.lastTrackingEventAt) {
        timeline.push({
          kind: 'TRACKING_UPDATED',
          label: 'Shipment update',
          at: so.lastTrackingEventAt,
          subOrderId: so.id,
        });
      }
      if (so.deliveredAt) {
        timeline.push({
          kind: 'SHIPMENT_DELIVERED',
          label: 'Delivered',
          at: so.deliveredAt,
          subOrderId: so.id,
        });
      }
    }
    if (order.orderStatus === 'CANCELLED') {
      // No dedicated cancelledAt field — best-effort to surface that
      // it happened. updatedAt is the last write, which is the cancel
      // for a cancelled order in practice.
      timeline.push({
        kind: 'ORDER_CANCELLED',
        label: 'Order cancelled',
        at: order.updatedAt,
      });
    }
    timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

    // Strip seller information — show "Fulfilled by SPORTSMART" label
    // Add customer-friendly status label. Tracking + delivery method
    // are surfaced so the customer detail screen can render a
    // "Track via iThink" link or display the self-delivery progress.
    const derivedStatus = this.deriveCustomerOrderStatus(
      order.orderStatus,
      order.subOrders,
    );

    // Phase 197 (My-Orders audit #10) — embed the in-flight returns
    // scoped to THIS order. Pre-Phase-197 the detail page fetched
    // `/customer/returns?limit=50` and filtered client-side to one
    // order (an N+1 + over-fetch + a 50-row cap that could miss a
    // return on a heavy account). Server-scoped by masterOrderId here.
    let orderReturns: Array<{
      id: string;
      returnNumber: string | null;
      status: string;
      createdAt: Date;
    }> = [];
    try {
      orderReturns = await this.prisma.return.findMany({
        where: { masterOrderId: order.id },
        select: {
          id: true,
          returnNumber: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      // Best-effort — the returns embed must never block the order page.
    }

    // Phase 197 (My-Orders audit #1) — explicit customer-safe whitelist
    // (see listCustomerOrders). The `...order` spread previously leaked
    // the full MasterOrder row to the buyer; build the response
    // field-by-field. paymentExpiresAt is the ONE additional field
    // surfaced (My-Orders audit #16, safe + needed so the UI hides the
    // Retry-payment CTA after the window closes).
    return {
      ...this.toCustomerSafeMasterOrder(order),
      paymentExpiresAt: order.paymentExpiresAt ?? null,
      orderStatus: derivedStatus,
      orderStatusLabel: this.mapOrderStatusLabel(derivedStatus),
      appliedDiscount,
      shipping,
      timeline,
      returns: orderReturns,
      // Phase 26 GST — per-item snapshots (BigInt → string for JSON
      // safety) + roll-up totals. Frontend renders these on the order
      // detail page so the customer sees a clear GST breakdown without
      // having to download the PDF invoice.
      taxSnapshots: taxSnapshots.map((t) => ({
        orderItemId: t.orderItemId,
        grossLineAmountInPaise: t.grossLineAmountInPaise.toString(),
        discountAmountInPaise: t.discountAmountInPaise.toString(),
        taxableAmountInPaise: t.taxableAmountInPaise.toString(),
        gstRateBps: t.gstRateBps,
        cgstAmountInPaise: t.cgstAmountInPaise.toString(),
        sgstAmountInPaise: t.sgstAmountInPaise.toString(),
        igstAmountInPaise: t.igstAmountInPaise.toString(),
        totalTaxAmountInPaise: t.totalTaxAmountInPaise.toString(),
      })),
      taxSummary: {
        taxableInPaise: taxSummary.taxableInPaise.toString(),
        cgstInPaise: taxSummary.cgstInPaise.toString(),
        sgstInPaise: taxSummary.sgstInPaise.toString(),
        igstInPaise: taxSummary.igstInPaise.toString(),
        totalTaxInPaise: taxSummary.totalTaxInPaise.toString(),
      },
      subOrders: order.subOrders.map((so: any) =>
        this.toCustomerSafeSubOrder(so),
      ),
    };
  }

  /**
   * Phase 197 (My-Orders audit #1/#2) — the single source of truth for
   * which MasterOrder columns are safe to return to the buyer. Every
   * customer-facing order response funnels through here so a column
   * added to MasterOrder later (commission*, a new risk signal, a new
   * gateway id) is excluded BY DEFAULT — a developer must consciously
   * add it to this whitelist for it to reach the customer.
   *
   * Deliberately EXCLUDED (internal / PII / fraud-signal):
   *   verificationRiskScore / Band / Reasons / Remarks,
   *   verified / verifiedAt / verifiedBy, claimedByAdminId / claimedAt /
   *   claimExpiresAt, verificationDeadlineAt / verificationScored*,
   *   selectedTaxProfileId, razorpayOrderId / razorpayPaymentId,
   *   lastFailedPaymentId / lastPaymentFailure*, lastPolledAt /
   *   pollAttemptCount / lastPollError, previousPaymentStatus,
   *   rejected* , paidBy / paymentReference / paymentNotes,
   *   walletTransactionId, idempotencyKey, sourceCartId /
   *   sourceCartSnapshot, finalizedAt, gstModeSnapshot, customerId.
   *
   * paymentExpiresAt is NOT included here (it's added explicitly by
   * the detail path only — the listing doesn't need it).
   */
  /**
   * Prorate the master-level wallet credit across active sub-orders by subtotal
   * weight, using a largest-remainder pass so the per-sub shares sum EXACTLY to
   * the master wallet (no 1-paise drift that would trip the cash-variance gate).
   * Returns this sub's share in paise. Uses Decimal subTotal, never the
   * dual-write-gated paise mirror.
   */
  private proratedWalletShareInPaise(master: any, sub: any): number {
    const masterWallet = Number(master?.walletAmountUsedInPaise ?? 0);
    if (masterWallet <= 0) return 0;
    const siblings = (master?.subOrders ?? []).filter(
      (s: any) => s.acceptStatus !== 'REJECTED',
    );
    if (siblings.length === 0) return 0;
    const grossOf = (s: any) => Math.round(Number(s.subTotal) * 100);
    const sumSub = siblings.reduce((a: number, s: any) => a + grossOf(s), 0);
    if (sumSub <= 0) return 0;
    const entries: Array<{ id: string; floor: number; frac: number }> =
      siblings.map((s: any) => {
        const exact = (masterWallet * grossOf(s)) / sumSub;
        const floor = Math.floor(exact);
        return { id: String(s.id), floor, frac: exact - floor };
      });
    const residual =
      masterWallet - entries.reduce((a, e) => a + e.floor, 0);
    // Hand the residual paise to the largest fractional parts; ties broken by
    // id so the allocation is deterministic across independent per-sub calls.
    const ranked = [...entries].sort(
      (a, b) => b.frac - a.frac || (a.id < b.id ? -1 : 1),
    );
    const bump = new Set<string>();
    for (let i = 0; i < residual && i < ranked.length; i++) {
      const entry = ranked[i];
      if (entry) bump.add(entry.id);
    }
    const mine = entries.find((e) => e.id === String(sub.id));
    if (!mine) return 0;
    return mine.floor + (bump.has(String(sub.id)) ? 1 : 0);
  }

  /**
   * Wallet-aware, customer-facing payment-method label. Wallet is modelled as a
   * credit on top of a base method (COD/ONLINE) — there is no WALLET enum value
   * — so derive the display string from walletAmountUsedInPaise vs the Decimal
   * total (the paise mirror is dual-write-gated and unreliable).
   */
  // Public so sibling services (e.g. FranchiseOrdersService, which injects
  // OrdersService) can render the same wallet-aware payment label.
  deriveEffectivePaymentLabel(o: any): string {
    const grossPaise = Math.round(Number(o?.totalAmount ?? 0) * 100);
    const walletPaise = Number(o?.walletAmountUsedInPaise ?? 0);
    const method = o?.paymentMethod;
    if (walletPaise > 0 && grossPaise > 0 && walletPaise >= grossPaise) {
      return 'Paid by Wallet';
    }
    if (walletPaise > 0) {
      const walletRupees = (walletPaise / 100).toFixed(2);
      return method === 'COD'
        ? `Cash on Delivery (Wallet ₹${walletRupees} applied)`
        : `Online (Wallet ₹${walletRupees} applied)`;
    }
    return method === 'COD'
      ? 'Cash on Delivery'
      : method === 'ONLINE'
        ? 'Online'
        : String(method ?? 'Unknown');
  }

  private toCustomerSafeMasterOrder(o: any) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      orderStatus: o.orderStatus,
      orderStatusLabel: this.mapOrderStatusLabel(o.orderStatus),
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      // Wallet-aware label for display. A full-wallet order reads "Paid by
      // Wallet" instead of the raw base method (COD/ONLINE), so a wallet
      // purchase is never mislabelled as Cash on Delivery.
      paymentMethodLabel: this.deriveEffectivePaymentLabel(o),
      walletAmountUsedInPaise:
        o.walletAmountUsedInPaise != null
          ? o.walletAmountUsedInPaise.toString()
          : '0',
      totalAmount: o.totalAmount,
      totalAmountInPaise:
        o.totalAmountInPaise != null ? o.totalAmountInPaise.toString() : null,
      currency: o.currency ?? 'INR',
      itemCount: o.itemCount,
      discountCode: o.discountCode ?? null,
      discountAmount: o.discountAmount ?? null,
      discountAmountInPaise:
        o.discountAmountInPaise != null
          ? o.discountAmountInPaise.toString()
          : null,
      shippingOptionName: o.shippingOptionName ?? null,
      shippingFeeInPaise:
        o.shippingFeeInPaise != null ? o.shippingFeeInPaise.toString() : null,
      shippingAddressSnapshot: o.shippingAddressSnapshot,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  }

  /**
   * Phase 197 (My-Orders audit #2) — typed customer-safe sub-order
   * shape. Locks out internal SubOrder columns (sellerId / franchiseId,
   * commissionRateSnapshot / commissionProcessed / commissionDecision /
   * commissionEarning, rejectionReason, lastCourierReasonCode, internal
   * SLA + NDR/RTO forensic fields) that the `...so` spread would leak if
   * anyone reverted the inline whitelist. `fulfilledBy` is forced to the
   * brand string so the seller identity never surfaces.
   */
  private toCustomerSafeSubOrder(so: any) {
    return {
      id: so.id,
      subTotal: so.subTotal,
      paymentStatus: so.paymentStatus,
      fulfillmentStatus: so.fulfillmentStatus,
      acceptStatus: so.acceptStatus,
      deliveredAt: so.deliveredAt ?? null,
      // Sprint 3 Story 2.5 — per-sub-order timestamps the timeline needs.
      acceptDeadlineAt: so.acceptDeadlineAt ?? null,
      lastTrackingEventAt: so.lastTrackingEventAt ?? null,
      returnWindowEndsAt: so.returnWindowEndsAt ?? null,
      // Customer never sees the seller; always "SPORTSMART".
      fulfilledBy: 'SPORTSMART',
      deliveryMethod: so.deliveryMethod ?? null,
      selfDeliveryStatus: so.selfDeliveryStatus ?? null,
      // Shipment tracking — surfaced so the customer sees the AWB and can
      // track the parcel from the order page (was omitted, so the AWB/track
      // block never rendered). Customer-facing tracking info, not internal
      // courier forensics (lastCourierReasonCode etc. stay excluded).
      trackingNumber: so.trackingNumber ?? null,
      courierName: so.courierName ?? null,
      trackingUrl: so.trackingUrl ?? null,
      items: (so.items ?? []).map((it: any) => this.toCustomerSafeItem(it)),
    };
  }

  /**
   * Phase 197 (My-Orders audit #2) — customer-safe order-item shape.
   * Matches the storefront `OrderItem` type. Excludes internal columns
   * (stockReservationId, imagePublicId, masterSku) and the paise
   * mirrors (the customer reads the Decimal unitPrice/totalPrice).
   */
  private toCustomerSafeItem(it: any) {
    return {
      id: it.id,
      productId: it.productId,
      variantId: it.variantId ?? null,
      productTitle: it.productTitle,
      variantTitle: it.variantTitle ?? null,
      sku: it.sku ?? null,
      imageUrl: it.imageUrl ?? null,
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      totalPrice: it.totalPrice,
    };
  }
}
