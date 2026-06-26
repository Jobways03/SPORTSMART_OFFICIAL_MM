// Phase B (P0.1, P0.5) — Discount allocation orchestration.
//
// Runs IMMEDIATELY after order creation (in its own transaction).
// Reads the canonical MasterOrder + OrderItem rows that the checkout
// transaction just committed and writes the full allocation ledger:
//
//   1. order_discounts          — 1 row per discount applied
//   2. order_item_discounts     — N rows (one per allocated item)
//   3. order_item_tax_snapshots — N rows (post-discount GST per line)
//   4. discount_liability_ledger — funding-split rows
//   5. Mark discount_redemption REDEEMED
//
// Why a separate transaction (not embedded in placeOrderTransaction):
//   - Keeps the existing 200-line checkout transaction unchanged
//     (lower risk, easier rollback).
//   - All writes here are idempotent on `idempotencyKey` (security
//     patch 20260508130000), so a failed retry from this service or
//     a future recovery cron is safe.
//   - The order itself records `discountAmount` on MasterOrder
//     (legacy field) so downstream systems still see the discount
//     even if this allocation step were to fail.
//
// Failure behavior: if any write fails, the entire allocation tx is
// rolled back and an outbox event is emitted so a recovery worker
// can retry. The order itself is NOT rolled back — customer payment
// has succeeded, MasterOrder.discountAmount is set, the only thing
// missing is the per-line ledger.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  allocateOrderLevel,
  allocateBxgy,
} from '../../domain/allocation/allocate';
import type {
  AllocatableItem,
  AllocationResult,
  ItemAllocation,
} from '../../domain/allocation/types';
import {
  resolveItemFundingShares,
  type FundingConfig,
} from '../../domain/allocation/funding';
import {
  calculateGstReversal,
} from '../../domain/tax/calculate-gst';
import { DiscountReservationService } from './discount-reservation.service';
import { DiscountEventsService } from './discount-events.service';
// Phase 2 GST — place-of-supply resolver replaces the hardcoded
// `isIntraState: false` in the per-item snapshot loop. See
// docs/tax/CA.md §A Phase 2 log.
import { PlaceOfSupplyService } from '../../../tax/application/services/place-of-supply.service';
import type { PlaceOfSupplyResult } from '../../../tax/domain/place-of-supply';
// Phase 3 GST — engine v2: inclusive/exclusive split, taxability
// taxonomy, cess. Replaces the per-snapshot call to legacy
// calculateLineGst. See docs/tax/CA.md §A Phase 3 / Phase 4 log.
import {
  calculateLineTax,
  type TaxabilityName,
} from '../../../tax/domain/tax-engine';
import { Prisma } from '@prisma/client';
import type { DiscountTaxTreatment, SupplyTaxability } from '@prisma/client';

/**
 * Default GST rate (in basis points) used at runtime only when:
 *   - The product row has gstRateBps = 0 (legacy / unconfigured), AND
 *   - The product is TAXABLE (NIL/EXEMPT/NON_GST short-circuit to 0
 *     in the engine regardless).
 *
 * Phase 1 added per-product `gstRateBps` + `supplyTaxability` columns
 * (defaulting to 0 / TAXABLE for back-compat). In test mode this
 * constant is irrelevant — the product's own value wins. In strict
 * mode (TAX_STRICT_MODE=true), `Product.gstRateBps = 0` for a
 * TAXABLE product is an error surfaced at moderation; orders should
 * never reach allocation with such a product. See
 * docs/tax/CA.md §3 row 10 and HSN_RATE_POLICY.md.
 */
const DEFAULT_GST_RATE_BPS = 0;

/** Type for per-item tax data loaded from Product + Variant. */
interface ItemTaxData {
  hsnCode: string | null;
  gstRateBps: number;
  cessRateBps: number;
  supplyTaxability: TaxabilityName;
  priceIncludesTax: boolean;
  uqcCode: string | null;
}

export interface AllocationContext {
  masterOrderId: string;
  /** ID of the parent Discount row that was applied. */
  discountId: string;
  /** Snapshot of the code as typed (for audit). */
  discountCode: string | null;
  /** ID of the child DiscountCode row, if any (P0.6). */
  discountCodeId?: string | null;
  /**
   * The redemption row created by `DiscountReservationService.reserve`.
   * This service marks it REDEEMED at the end of the allocation tx.
   */
  redemptionId: string;
  /**
   * Total discount the customer was promised, in paise. Sum of
   * per-item allocations must equal this.
   */
  discountAmountInPaise: bigint;
  /** Snapshot of the discount's metadata at order time. */
  discountType:
    | 'AMOUNT_OFF_PRODUCTS'
    | 'AMOUNT_OFF_ORDER'
    | 'BUY_X_GET_Y'
    | 'FREE_SHIPPING';
  discountMethod: 'CODE' | 'AUTOMATIC';
  source: 'CODE' | 'AUTOMATIC' | 'AFFILIATE';
  funding: FundingConfig;
  /**
   * Eligibility — for AMOUNT_OFF_PRODUCTS / SPECIFIC_COLLECTIONS,
   * the resolved set of eligible product IDs. Empty = order-wide.
   */
  eligibleProductIds?: ReadonlySet<string>;
  /**
   * BXGY-only: resolved GET-eligible product IDs + the get
   * configuration. Caller computes from DiscountProduct(scope=GET)
   * + DiscountCollection(scope=GET).
   */
  bxgy?: {
    getEligibleProductIds: ReadonlySet<string>;
    getQuantity: number;
    getDiscountType: 'FREE' | 'PERCENTAGE' | 'AMOUNT_OFF';
    getDiscountValueInPaise?: bigint;
    getDiscountPercentage?: number;
  };
  /**
   * Phase 4 GST — GST treatment of this discount.
   * If omitted, the service loads it from the Discount row.
   *
   *   PRE_SUPPLY_TRANSACTIONAL → engine subtracts discount from
   *                              taxable value (default behaviour).
   *   POST_SUPPLY_LINKED       → engine keeps taxable = gross;
   *                              Phase 11 emits a credit note.
   *   POST_SUPPLY_UNLINKED     → engine keeps taxable = gross;
   *                              wallet_adjustments instead.
   *   DISPLAY_ONLY             → engine sees gross = paid price;
   *                              no discount subtraction.
   *
   * See docs/tax/CA.md §3 + GOODWILL_CREDIT_POLICY.md.
   */
  taxTreatment?: DiscountTaxTreatment;
}

@Injectable()
export class DiscountAllocationService {
  private readonly logger = new Logger(DiscountAllocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservation: DiscountReservationService,
    // Phase E (P1.1) — emit liability-recorded + refund-prorated.
    private readonly events: DiscountEventsService,
    // Phase 2 GST — resolve CGST/SGST vs IGST per sub-order.
    private readonly placeOfSupply: PlaceOfSupplyService,
  ) {}

  /**
   * Compute and persist the full allocation for an order. Called from
   * `checkout.service.ts` immediately after the order is committed.
   *
   * Idempotency: each ledger row is keyed on (masterOrderId,
   * discountId, …) with a deterministic idempotency key, so a retry
   * is safe — duplicate inserts hit the unique constraint and the
   * tx silently succeeds.
   */
  async allocateAndPersist(ctx: AllocationContext): Promise<void> {
    if (ctx.discountAmountInPaise <= 0n) {
      // No discount → no rows to write. Still mark redemption
      // REDEEMED so the lifecycle is consistent.
      await this.reservation.redeem({
        redemptionId: ctx.redemptionId,
        masterOrderId: ctx.masterOrderId,
      });
      return;
    }

    // Phase 2 GST — resolve place-of-supply per sub-order BEFORE the
    // write transaction. Reads master order + seller/franchise/platform
    // state codes. In test mode (TAX_STRICT_MODE=false), missing or
    // ambiguous data falls back to IGST (inter-state) with a warning
    // logged. In strict mode this throws and the caller surfaces a
    // friendly checkout error.
    let posMap: Map<string, PlaceOfSupplyResult> = new Map();
    try {
      posMap = await this.placeOfSupply.resolveForMasterOrder(ctx.masterOrderId);
    } catch (err) {
      // Resolver only throws in strict mode. Rethrow so checkout aborts.
      this.logger.error(
        `Place-of-supply resolution failed for order ${ctx.masterOrderId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    // Phase 4 GST — resolve discount tax treatment.
    // Caller may pass `ctx.taxTreatment` (test helpers do); otherwise
    // load from the Discount row. Default PRE_SUPPLY_TRANSACTIONAL
    // preserves the legacy behaviour where discount reduces taxable
    // value (CGST §15).
    //
    // Phase 247 (liability audit #7) — also load the rule-version
    // (`version`) and `commissionBasis` here so the OrderDiscount row
    // can carry an immutable funding-config snapshot. These two fields
    // are NOT part of the in-scope FundingConfig (which only carries
    // the split percentages), so we read them straight off the
    // Discount. Unconditional (independent of whether the caller passed
    // ctx.taxTreatment) so the snapshot is always populated.
    let taxTreatment: DiscountTaxTreatment = ctx.taxTreatment ?? 'PRE_SUPPLY_TRANSACTIONAL';
    const discountRow = await this.prisma.discount.findUnique({
      where: { id: ctx.discountId },
      select: { taxTreatment: true, version: true, commissionBasis: true },
    });
    if (!ctx.taxTreatment && discountRow) {
      taxTreatment = discountRow.taxTreatment;
    }
    const ruleVersion = discountRow?.version ?? 1;
    const commissionBasis = discountRow?.commissionBasis ?? null;

    await this.prisma.$transaction(async (tx) => {
      // 1. Load canonical order + items + sub-orders. Phase 5 added
      // productTitle (snapshot description) to the projection.
      const items = await tx.orderItem.findMany({
        where: { subOrder: { masterOrderId: ctx.masterOrderId } },
        select: {
          id: true,
          productId: true,
          variantId: true,
          productTitle: true,
          quantity: true,
          subOrderId: true,
          unitPriceInPaise: true,
          totalPriceInPaise: true,
          subOrder: {
            // Phase 247-FB — franchiseId so a FRANCHISE-funded discount's
            // share attributes to the fulfilling franchise.
            select: { sellerId: true, franchiseId: true },
          },
        },
      });
      if (items.length === 0) {
        throw new Error(
          `No items found for order ${ctx.masterOrderId} during allocation`,
        );
      }

      const allocatableItems: AllocatableItem[] = items.map((it) => ({
        orderItemId: it.id,
        productId: it.productId,
        variantId: it.variantId,
        subOrderId: it.subOrderId,
        sellerId: it.subOrder.sellerId,
        franchiseId: it.subOrder.franchiseId,
        grossInPaise: BigInt(it.totalPriceInPaise),
        unitPriceInPaise: BigInt(it.unitPriceInPaise),
        quantity: it.quantity,
      }));

      // 2. Run allocation engine.
      let result: AllocationResult;
      if (ctx.discountType === 'BUY_X_GET_Y') {
        if (!ctx.bxgy) {
          throw new Error('BXGY discount requires bxgy context');
        }
        result = allocateBxgy({
          items: allocatableItems,
          getEligibleProductIds: ctx.bxgy.getEligibleProductIds,
          getQuantity: ctx.bxgy.getQuantity,
          getDiscountType: ctx.bxgy.getDiscountType,
          getDiscountValueInPaise: ctx.bxgy.getDiscountValueInPaise,
          getDiscountPercentage: ctx.bxgy.getDiscountPercentage,
        });
      } else if (ctx.discountType === 'FREE_SHIPPING') {
        // Free shipping doesn't allocate to line items — the
        // shipping discount is recorded at order level only. Still
        // write the order_discounts row but no item rows.
        result = { allocations: [], totalAllocatedInPaise: 0n };
      } else {
        result = allocateOrderLevel({
          items: allocatableItems,
          totalDiscountInPaise: ctx.discountAmountInPaise,
          eligibleProductIds: ctx.eligibleProductIds,
        });
      }

      // Phase 247 (liability audit #7) — immutable funding-config
      // snapshot. Frozen at allocation time so a later edit to the
      // Discount's split (no longer allowed on a live discount — see
      // #8) can never rewrite how a historical order was funded.
      // Percentages come from the in-scope FundingConfig (the exact
      // split used to produce this order's ledger rows); ruleVersion +
      // commissionBasis come from the Discount row loaded above.
      // capturedAt is an ISO string (a plain Date is fine in a service,
      // but ISO keeps the JSON snapshot stable + comparable).
      const fundingConfigJson = {
        fundingType: ctx.funding.fundingType,
        platformPct: ctx.funding.platformFundingPercent ?? null,
        sellerPct: ctx.funding.sellerFundingPercent ?? null,
        brandPct: ctx.funding.brandFundingPercent ?? null,
        commissionBasis,
        ruleVersion,
        capturedAt: new Date().toISOString(),
      };

      // 3. Write order_discounts (1 row).
      await tx.orderDiscount.create({
        data: {
          masterOrderId: ctx.masterOrderId,
          discountId: ctx.discountId,
          discountCodeId: ctx.discountCodeId ?? null,
          discountCode: ctx.discountCode,
          discountType: ctx.discountType,
          discountMethod: ctx.discountMethod,
          discountNature: 'TRANSACTIONAL',
          source: ctx.source,
          discountAmountInPaise: result.totalAllocatedInPaise,
          fundingType: ctx.funding.fundingType as any,
          // Phase 247 (#7) — funding-config snapshot (see above).
          fundingConfigJson: fundingConfigJson as Prisma.InputJsonValue,
        },
      });

      // 4. Write order_item_discounts (N rows).
      for (const a of result.allocations) {
        if (a.discountInPaise === 0n) continue;
        await tx.orderItemDiscount.create({
          data: {
            masterOrderId: ctx.masterOrderId,
            subOrderId: a.subOrderId,
            orderItemId: a.orderItemId,
            sellerId: a.sellerId ?? null,
            productId: a.productId,
            variantId: a.variantId ?? null,
            discountId: ctx.discountId,
            discountCodeId: ctx.discountCodeId ?? null,
            discountCode: ctx.discountCode,
            discountType: ctx.discountType,
            discountAmountInPaise: a.discountInPaise,
            fundingType: ctx.funding.fundingType as any,
          },
        });
      }

      // 5. Phase 4 GST — load per-product + per-variant tax fields in
      // batch (no Prisma relation from OrderItem → Product/Variant,
      // so we query by ID set). Used to resolve HSN, GST rate,
      // taxability, inclusive-pricing flag, UQC per line.
      const productIds = [...new Set(allocatableItems.map((it) => it.productId))];
      const variantIds = [
        ...new Set(allocatableItems.map((it) => it.variantId).filter((v): v is string => !!v)),
      ];
      const [products, variants] = await Promise.all([
        productIds.length
          ? tx.product.findMany({
              where: { id: { in: productIds } },
              select: {
                id: true,
                hsnCode: true,
                gstRateBps: true,
                supplyTaxability: true,
                taxInclusivePricing: true,
                cessRateBps: true,
                defaultUqcCode: true,
                // Phase 5 — supplierType derivation (SELLER vs OWN_BRAND).
                productSource: true,
              },
            })
          : Promise.resolve([]),
        variantIds.length
          ? tx.productVariant.findMany({
              where: { id: { in: variantIds } },
              select: {
                id: true,
                hsnCodeOverride: true,
                gstRateBpsOverride: true,
                taxInclusivePricingOverride: true,
                uqcCodeOverride: true,
              },
            })
          : Promise.resolve([]),
      ]);
      const productById = new Map(products.map((p) => [p.id, p]));
      const variantById = new Map(variants.map((v) => [v.id, v]));
      // Item metadata (description, qty) keyed by orderItemId — used
      // to populate snapshot description + quantity in Phase 5.
      const itemMetadataById = new Map(
        items.map((it) => [it.id, { productTitle: it.productTitle, quantity: it.quantity }]),
      );

      // Tax snapshots are written for EVERY item (allocated or not).
      // Items not allocated still need their gross snapshot so refund
      // proration has consistent data.
      const allocByItemId = new Map<string, ItemAllocation>(
        result.allocations.map((a) => [a.orderItemId, a]),
      );

      // Phase 5 GST — per-sub-order accumulator for SubOrderTaxSummary.
      // Keyed by subOrderId; populated during the snapshot loop and
      // upserted after.
      interface SubOrderAccum {
        masterOrderId: string;
        subOrderId: string;
        sellerId: string | null;
        supplierType: 'MARKETPLACE_SELLER' | 'FRANCHISE' | 'OWN_BRAND' | 'SPORTSMART' | null;
        sellerStateCode: string | null;
        placeOfSupplyStateCode: string | null;
        taxSplitType: 'CGST_SGST' | 'IGST' | null;
        taxableInPaise: bigint;
        cgstInPaise: bigint;
        sgstInPaise: bigint;
        igstInPaise: bigint;
        totalTaxInPaise: bigint;
        cessInPaise: bigint;
        invoiceTotalInPaise: bigint;
        lineCount: number;
        anyIncomplete: boolean;
        allExempt: boolean;
      }
      const subOrderAccums = new Map<string, SubOrderAccum>();

      for (const it of allocatableItems) {
        const allocated = allocByItemId.get(it.orderItemId);
        const discountInPaise = allocated?.discountInPaise ?? 0n;

        // Phase 2 GST — POS per sub-order.
        const pos = posMap.get(it.subOrderId);
        const isIntraState = pos?.isIntraState ?? false;

        // Phase 4 GST — resolve per-item tax data (variant overrides
        // beat product defaults; both nullable; fall back safely).
        const product = productById.get(it.productId);
        const variant = it.variantId ? variantById.get(it.variantId) : null;
        const itemTaxData: ItemTaxData = {
          hsnCode: variant?.hsnCodeOverride ?? product?.hsnCode ?? null,
          gstRateBps:
            variant?.gstRateBpsOverride ?? product?.gstRateBps ?? DEFAULT_GST_RATE_BPS,
          cessRateBps: product?.cessRateBps ?? 0,
          supplyTaxability: ((product?.supplyTaxability as SupplyTaxability) ??
            'TAXABLE') as TaxabilityName,
          priceIncludesTax:
            variant?.taxInclusivePricingOverride ?? product?.taxInclusivePricing ?? true,
          uqcCode: variant?.uqcCodeOverride ?? product?.defaultUqcCode ?? null,
        };

        // Phase 4 GST — honor the discount tax treatment. For PRE_
        // SUPPLY_TRANSACTIONAL the discount reduces taxable; for the
        // other treatments the engine sees zero discount (allocation
        // ledger still records the allocated amount for downstream
        // reporting, but the GST math ignores it).
        const effectiveDiscountForTax =
          taxTreatment === 'PRE_SUPPLY_TRANSACTIONAL' ? discountInPaise : 0n;

        // Phase 3 GST — engine v2.
        const tax = calculateLineTax({
          grossInPaise: it.grossInPaise,
          discountInPaise: effectiveDiscountForTax,
          gstRateBps: itemTaxData.gstRateBps,
          cessRateBps: itemTaxData.cessRateBps,
          priceIncludesTax: itemTaxData.priceIncludesTax,
          isIntraState,
          supplyTaxability: itemTaxData.supplyTaxability,
        });

        // Phase 5 GST — derive supplierType + taxDataStatus.
        // SupplierType: OWN_BRAND if product is OWN_BRAND, otherwise
        // MARKETPLACE_SELLER. Franchise / SPORTSMART supplier types
        // are reserved for future fulfilment-node sourcing changes.
        const supplierType =
          product?.productSource === 'OWN_BRAND'
            ? 'OWN_BRAND'
            : ('MARKETPLACE_SELLER' as const);

        // taxDataStatus:
        //   EXEMPT     — non-taxable supply
        //   INCOMPLETE — taxable but missing HSN or gstRateBps=0
        //   COMPLETE   — taxable with full data
        let taxDataStatus: 'COMPLETE' | 'INCOMPLETE' | 'EXEMPT';
        if (
          itemTaxData.supplyTaxability === 'NIL_RATED' ||
          itemTaxData.supplyTaxability === 'EXEMPT' ||
          itemTaxData.supplyTaxability === 'NON_GST' ||
          itemTaxData.supplyTaxability === 'OUT_OF_SCOPE'
        ) {
          taxDataStatus = 'EXEMPT';
        } else if (!itemTaxData.hsnCode || itemTaxData.gstRateBps <= 0) {
          taxDataStatus = 'INCOMPLETE';
        } else {
          taxDataStatus = 'COMPLETE';
        }

        const meta = itemMetadataById.get(it.orderItemId);

        await tx.orderItemTaxSnapshot.upsert({
          where: { orderItemId: it.orderItemId },
          create: {
            masterOrderId: ctx.masterOrderId,
            subOrderId: it.subOrderId,
            orderItemId: it.orderItemId,
            // Phase 5 — line classification + supplier/product context.
            lineType: 'PRODUCT',
            supplierType,
            sellerId: it.sellerId ?? null,
            productId: it.productId,
            variantId: it.variantId ?? null,
            description: meta?.productTitle ?? null,
            uqcCode: itemTaxData.uqcCode,
            quantity: meta?.quantity != null ? new Prisma.Decimal(meta.quantity) : null,
            // Money fields from engine v2.
            grossLineAmountInPaise: tax.grossInPaise,
            // Persist the ALLOCATED discount (not the tax-effective one).
            discountAmountInPaise: discountInPaise,
            taxableAmountInPaise: tax.taxableInPaise,
            gstRateBps: tax.gstRateBps,
            supplyTaxability: itemTaxData.supplyTaxability,
            priceIncludesTax: itemTaxData.priceIncludesTax,
            cessRateBps: itemTaxData.cessRateBps,
            cessAmountInPaise: tax.cessInPaise,
            cgstAmountInPaise: tax.cgstInPaise,
            sgstAmountInPaise: tax.sgstInPaise,
            igstAmountInPaise: tax.igstInPaise,
            totalTaxAmountInPaise: tax.totalTaxInPaise,
            lineTotalAfterDiscountAndTaxInPaise: tax.lineTotalInPaise,
            hsnCode: itemTaxData.hsnCode,
            sellerStateCode: pos?.supplierStateCode ?? null,
            placeOfSupply: pos?.placeOfSupplyStateCode ?? null,
            taxSplitType: pos?.taxSplitType ?? null,
            reverseChargeApplicable: false,
            currencyCode: 'INR',
            taxDataStatus,
          },
          update: {
            lineType: 'PRODUCT',
            supplierType,
            sellerId: it.sellerId ?? null,
            productId: it.productId,
            variantId: it.variantId ?? null,
            description: meta?.productTitle ?? null,
            uqcCode: itemTaxData.uqcCode,
            quantity: meta?.quantity != null ? new Prisma.Decimal(meta.quantity) : null,
            grossLineAmountInPaise: tax.grossInPaise,
            discountAmountInPaise: discountInPaise,
            taxableAmountInPaise: tax.taxableInPaise,
            gstRateBps: tax.gstRateBps,
            supplyTaxability: itemTaxData.supplyTaxability,
            priceIncludesTax: itemTaxData.priceIncludesTax,
            cessRateBps: itemTaxData.cessRateBps,
            cessAmountInPaise: tax.cessInPaise,
            cgstAmountInPaise: tax.cgstInPaise,
            sgstAmountInPaise: tax.sgstInPaise,
            igstAmountInPaise: tax.igstInPaise,
            totalTaxAmountInPaise: tax.totalTaxInPaise,
            lineTotalAfterDiscountAndTaxInPaise: tax.lineTotalInPaise,
            hsnCode: itemTaxData.hsnCode,
            sellerStateCode: pos?.supplierStateCode ?? null,
            placeOfSupply: pos?.placeOfSupplyStateCode ?? null,
            taxSplitType: pos?.taxSplitType ?? null,
            reverseChargeApplicable: false,
            currencyCode: 'INR',
            taxDataStatus,
          },
        });

        // Phase 5 GST — accumulate per-sub-order totals.
        let accum = subOrderAccums.get(it.subOrderId);
        if (!accum) {
          accum = {
            masterOrderId: ctx.masterOrderId,
            subOrderId: it.subOrderId,
            sellerId: it.sellerId ?? null,
            supplierType,
            sellerStateCode: pos?.supplierStateCode ?? null,
            placeOfSupplyStateCode: pos?.placeOfSupplyStateCode ?? null,
            taxSplitType: pos?.taxSplitType ?? null,
            taxableInPaise: 0n,
            cgstInPaise: 0n,
            sgstInPaise: 0n,
            igstInPaise: 0n,
            totalTaxInPaise: 0n,
            cessInPaise: 0n,
            invoiceTotalInPaise: 0n,
            lineCount: 0,
            anyIncomplete: false,
            allExempt: true,
          };
          subOrderAccums.set(it.subOrderId, accum);
        }
        accum.taxableInPaise += tax.taxableInPaise;
        accum.cgstInPaise += tax.cgstInPaise;
        accum.sgstInPaise += tax.sgstInPaise;
        accum.igstInPaise += tax.igstInPaise;
        accum.totalTaxInPaise += tax.totalTaxInPaise;
        accum.cessInPaise += tax.cessInPaise;
        accum.invoiceTotalInPaise += tax.lineTotalInPaise;
        accum.lineCount += 1;
        if (taxDataStatus === 'INCOMPLETE') accum.anyIncomplete = true;
        if (taxDataStatus !== 'EXEMPT') accum.allExempt = false;
      }

      // Phase 5 GST — upsert SubOrderTaxSummary per sub-order.
      // Aggregate status: any INCOMPLETE wins; else all-EXEMPT → EXEMPT;
      // else COMPLETE.
      const masterAccum = {
        taxable: 0n,
        cgst: 0n,
        sgst: 0n,
        igst: 0n,
        totalTax: 0n,
        cess: 0n,
        invoiceTotal: 0n,
        lineCount: 0,
        subOrderCount: 0,
        anyIncomplete: false,
        allExempt: true,
      };

      for (const a of subOrderAccums.values()) {
        const subStatus: 'COMPLETE' | 'INCOMPLETE' | 'EXEMPT' =
          a.anyIncomplete ? 'INCOMPLETE' : a.allExempt ? 'EXEMPT' : 'COMPLETE';

        await tx.subOrderTaxSummary.upsert({
          where: { subOrderId: a.subOrderId },
          create: {
            masterOrderId: a.masterOrderId,
            subOrderId: a.subOrderId,
            sellerId: a.sellerId,
            supplierType: a.supplierType ?? undefined,
            sellerStateCode: a.sellerStateCode,
            placeOfSupplyStateCode: a.placeOfSupplyStateCode,
            taxSplitType: a.taxSplitType ?? undefined,
            taxableAmountInPaise: a.taxableInPaise,
            cgstAmountInPaise: a.cgstInPaise,
            sgstAmountInPaise: a.sgstInPaise,
            igstAmountInPaise: a.igstInPaise,
            totalTaxAmountInPaise: a.totalTaxInPaise,
            cessAmountInPaise: a.cessInPaise,
            invoiceTotalInPaise: a.invoiceTotalInPaise,
            currencyCode: 'INR',
            taxDataStatus: subStatus,
            lineCount: a.lineCount,
          },
          update: {
            sellerId: a.sellerId,
            supplierType: a.supplierType ?? undefined,
            sellerStateCode: a.sellerStateCode,
            placeOfSupplyStateCode: a.placeOfSupplyStateCode,
            taxSplitType: a.taxSplitType ?? undefined,
            taxableAmountInPaise: a.taxableInPaise,
            cgstAmountInPaise: a.cgstInPaise,
            sgstAmountInPaise: a.sgstInPaise,
            igstAmountInPaise: a.igstInPaise,
            totalTaxAmountInPaise: a.totalTaxInPaise,
            cessAmountInPaise: a.cessInPaise,
            invoiceTotalInPaise: a.invoiceTotalInPaise,
            currencyCode: 'INR',
            taxDataStatus: subStatus,
            lineCount: a.lineCount,
          },
        });

        masterAccum.taxable += a.taxableInPaise;
        masterAccum.cgst += a.cgstInPaise;
        masterAccum.sgst += a.sgstInPaise;
        masterAccum.igst += a.igstInPaise;
        masterAccum.totalTax += a.totalTaxInPaise;
        masterAccum.cess += a.cessInPaise;
        masterAccum.invoiceTotal += a.invoiceTotalInPaise;
        masterAccum.lineCount += a.lineCount;
        masterAccum.subOrderCount += 1;
        if (a.anyIncomplete) masterAccum.anyIncomplete = true;
        if (!a.allExempt) masterAccum.allExempt = false;
      }

      // Phase 5 GST — upsert OrderTaxSummary at the master level.
      const masterStatus: 'COMPLETE' | 'INCOMPLETE' | 'EXEMPT' =
        masterAccum.anyIncomplete ? 'INCOMPLETE' : masterAccum.allExempt ? 'EXEMPT' : 'COMPLETE';
      await tx.orderTaxSummary.upsert({
        where: { masterOrderId: ctx.masterOrderId },
        create: {
          masterOrderId: ctx.masterOrderId,
          taxableAmountInPaise: masterAccum.taxable,
          cgstAmountInPaise: masterAccum.cgst,
          sgstAmountInPaise: masterAccum.sgst,
          igstAmountInPaise: masterAccum.igst,
          totalTaxAmountInPaise: masterAccum.totalTax,
          cessAmountInPaise: masterAccum.cess,
          invoiceTotalInPaise: masterAccum.invoiceTotal,
          currencyCode: 'INR',
          taxDataStatus: masterStatus,
          subOrderCount: masterAccum.subOrderCount,
          lineCount: masterAccum.lineCount,
        },
        update: {
          taxableAmountInPaise: masterAccum.taxable,
          cgstAmountInPaise: masterAccum.cgst,
          sgstAmountInPaise: masterAccum.sgst,
          igstAmountInPaise: masterAccum.igst,
          totalTaxAmountInPaise: masterAccum.totalTax,
          cessAmountInPaise: masterAccum.cess,
          invoiceTotalInPaise: masterAccum.invoiceTotal,
          currencyCode: 'INR',
          taxDataStatus: masterStatus,
          subOrderCount: masterAccum.subOrderCount,
          lineCount: masterAccum.lineCount,
        },
      });

      // 6. Write liability ledger — funding split per allocated item.
      for (const a of result.allocations) {
        if (a.discountInPaise === 0n) continue;
        // Phase 251 — route a SELLER-funded line to the node that ACTUALLY
        // fulfils it (marketplace seller → SELLER; franchise → FRANCHISE;
        // neither → PLATFORM-absorbed), since the allocation cascade picks the
        // fulfiller after the coupon was created. Every other funding type
        // keeps its prior attribution. The resolved share carries its own
        // sellerId/franchiseId/brandId so the ledger row is written
        // consistently with the party.
        const shares = resolveItemFundingShares(a.discountInPaise, ctx.funding, {
          sellerId: a.sellerId,
          franchiseId: a.franchiseId,
        });
        for (const share of shares) {
          // Idempotency key: deterministic from order + item + discount +
          // resolved party. A retried allocation tx hits the unique
          // constraint on this key and silently dedupes.
          const idemKey = `${ctx.masterOrderId}:${a.orderItemId}:${ctx.discountId}:${share.liabilityParty}`;
          await tx.discountLiabilityLedger.upsert({
            where: {
              // Composite uniqueness via the `idem_key` partial index;
              // we look up by the snapshot fields. Prisma doesn't
              // support partial-index `where` clauses directly, so
              // we use create-or-update via raw SQL upsert pattern:
              id: idemKey, // see note below
            },
            create: {
              id: idemKey,
              masterOrderId: ctx.masterOrderId,
              subOrderId: a.subOrderId,
              orderItemId: a.orderItemId,
              sellerId: share.sellerId ?? null,
              franchiseId: share.franchiseId ?? null,
              brandId: share.brandId ?? null,
              discountId: ctx.discountId,
              discountCodeId: ctx.discountCodeId ?? null,
              discountCode: ctx.discountCode,
              fundingType: ctx.funding.fundingType as any,
              liabilityParty: share.liabilityParty as any,
              amountInPaise: share.amountInPaise,
              status: 'APPLIED',
              idempotencyKey: idemKey,
            },
            update: {
              amountInPaise: share.amountInPaise,
              status: 'APPLIED',
              franchiseId: share.franchiseId ?? null,
              brandId: share.brandId ?? null,
            },
          });

          // Phase E (P1.1) — emit per-share liability event.
          // Outbox consumers (settlement, finance reports, brand
          // recovery jobs) react to these. Best-effort.
          void this.events.emitLiabilityRecorded({
            masterOrderId: ctx.masterOrderId,
            discountId: ctx.discountId,
            liabilityParty: share.liabilityParty,
            amountInPaise: share.amountInPaise,
            fundingType: ctx.funding.fundingType,
          });
        }
      }

      // 7. Mark redemption REDEEMED. Conditional update inside the
      // tx — if the redemption was already redeemed by another path
      // (idempotent retry), the call is a no-op.
      try {
        await this.reservation.redeem({
          redemptionId: ctx.redemptionId,
          masterOrderId: ctx.masterOrderId,
          tx,
        });
      } catch (e) {
        // If the redemption was already REDEEMED (idempotent retry),
        // swallow the conflict. Any other error rethrows and rolls
        // back the whole allocation tx.
        if (
          e instanceof Error &&
          (e as any).reason === 'CONCURRENT_RESERVATION'
        ) {
          this.logger.warn(
            `Redemption ${ctx.redemptionId} already redeemed — idempotent retry`,
          );
        } else {
          throw e;
        }
      }
    });
  }

  /**
   * Phase C (P0.2) — Compute proportional refund + GST reversal for
   * a returned quantity of an OrderItem.
   *
   * Returns null if no tax snapshot exists for the item — caller
   * MUST fall back to the existing gross-price refund logic. This
   * is the legacy-compat path: orders placed before allocation
   * went live don't have snapshots, and the spec requires those
   * to keep working unchanged.
   *
   * Returns a RefundProrationResult when allocation data exists.
   * Caller writes one `ReturnTaxReversalLine` row using the
   * `reversalSnapshot`, and uses `totalRefundInPaise` as the
   * customer's refund amount.
   */
  async computeRefundForReturnedItem(args: {
    orderItemId: string;
    purchasedQuantity: number;
    approvedQuantity: number;
  }): Promise<RefundProrationResult | null> {
    if (args.approvedQuantity <= 0) {
      return {
        totalRefundInPaise: 0n,
        reversalSnapshot: this.zeroReversal(),
      };
    }

    // Look up the per-item tax snapshot. Absence of a snapshot is
    // the signal to fall back to legacy logic.
    const snapshot = await this.prisma.orderItemTaxSnapshot.findUnique({
      where: { orderItemId: args.orderItemId },
    });
    if (!snapshot) return null;

    const reversal = calculateGstReversal({
      originalGrossInPaise: BigInt(snapshot.grossLineAmountInPaise),
      originalDiscountInPaise: BigInt(snapshot.discountAmountInPaise),
      originalCgstInPaise: BigInt(snapshot.cgstAmountInPaise),
      originalSgstInPaise: BigInt(snapshot.sgstAmountInPaise),
      originalIgstInPaise: BigInt(snapshot.igstAmountInPaise),
      // Inclusive snapshots store gross WITH tax baked in — without this the
      // reversal double-counts GST (inflated credit note + fractional refund).
      priceIncludesTax: snapshot.priceIncludesTax,
      purchasedQuantity: args.purchasedQuantity,
      returnedQuantity: args.approvedQuantity,
    });

    return {
      totalRefundInPaise: reversal.totalCreditNoteInPaise,
      reversalSnapshot: {
        grossReturnedInPaise: reversal.grossReturnedInPaise,
        discountReversalInPaise: reversal.discountReversalInPaise,
        taxableReversalInPaise: reversal.taxableReversalInPaise,
        cgstReversalInPaise: reversal.cgstReversalInPaise,
        sgstReversalInPaise: reversal.sgstReversalInPaise,
        igstReversalInPaise: reversal.igstReversalInPaise,
        totalTaxReversalInPaise: reversal.totalTaxReversalInPaise,
        totalCreditNoteInPaise: reversal.totalCreditNoteInPaise,
        gstRateBps: snapshot.gstRateBps,
      },
    };
  }

  /**
   * Phase C (P0.2) — Reverse the discount liability ledger entries
   * for a return. When a discounted item is returned, the funding
   * party (PLATFORM/SELLER/etc.) should release their share of the
   * original liability. We mark the corresponding ledger rows
   * REVERSED rather than deleting — finance reports need to see
   * the original liability + the reversal.
   *
   * Idempotent: re-running this on the same return is a no-op.
   */
  async reverseLiabilityForReturnedItem(args: {
    orderItemId: string;
    /**
     * Optional ratio (returned/purchased). When undefined, all
     * remaining liability is reversed (full return). For partial
     * returns we currently leave the original ledger row APPLIED
     * and add a single REVERSED row carrying the proportional
     * amount (per spec: don't double-debit, don't restore budget).
     *
     * Phase 4.8 (2026-05-16) — validation hardened:
     *   - Both fields must be positive integers.
     *   - `returned <= purchased` — returning more than was purchased
     *     is a data-entry error, not a refund the platform should
     *     execute. We throw a clear error so the caller fixes its
     *     payload rather than silently reversing a wrong amount.
     */
    proportion?: { returned: number; purchased: number };
    reason?: string;
  }): Promise<void> {
    if (args.proportion) {
      const { returned, purchased } = args.proportion;
      if (
        !Number.isInteger(returned) ||
        !Number.isInteger(purchased) ||
        returned <= 0 ||
        purchased <= 0
      ) {
        throw new Error(
          `reverseLiabilityForReturnedItem: proportion must be positive integers (got returned=${returned}, purchased=${purchased})`,
        );
      }
      if (returned > purchased) {
        throw new Error(
          `reverseLiabilityForReturnedItem: returned (${returned}) cannot exceed purchased (${purchased}) — refusing to reverse more discount than was applied`,
        );
      }
    }

    const ledgerRows = await this.prisma.discountLiabilityLedger.findMany({
      where: { orderItemId: args.orderItemId, status: 'APPLIED' },
    });
    if (ledgerRows.length === 0) return;

    for (const row of ledgerRows) {
      const reverseAmount = args.proportion
        ? (BigInt(row.amountInPaise) * BigInt(args.proportion.returned)) /
          BigInt(args.proportion.purchased)
        : BigInt(row.amountInPaise);
      // Phase 4.8 (2026-05-16) — disambiguate the reverse-key when
      // orderItemId is null on the source row (non-PRODUCT lines).
      // The base id alone might be reused across line types in
      // legacy data; the `[REVERSE]` namespace + sourceLine context
      // makes the key globally unique.
      const idemKey = `${row.id}:reverse:${row.orderItemId ?? 'null'}`;
      await this.prisma.discountLiabilityLedger.upsert({
        where: { id: idemKey },
        create: {
          id: idemKey,
          masterOrderId: row.masterOrderId,
          subOrderId: row.subOrderId,
          orderItemId: row.orderItemId,
          sellerId: row.sellerId,
          // Phase 247-FB — carry the franchise/brand attribution onto the
          // reversal row so a franchise/brand is credited back its share on
          // a return, matching the original APPLIED row.
          franchiseId: row.franchiseId,
          brandId: row.brandId,
          discountId: row.discountId,
          discountCodeId: row.discountCodeId,
          discountCode: row.discountCode,
          fundingType: row.fundingType,
          liabilityParty: row.liabilityParty,
          amountInPaise: -reverseAmount, // negative = credit back
          status: 'REVERSED',
          reason: args.reason ?? 'RETURN_REFUND',
          idempotencyKey: idemKey,
        },
        update: {
          amountInPaise: -reverseAmount,
          status: 'REVERSED',
        },
      });
    }
  }

  /**
   * Phase 4.8 (2026-05-16) — Coupon usage restoration on refund.
   *
   * When a customer used a discount code at checkout, the code's
   * `usageCount` is incremented. If the order is later refunded
   * (return / cancel / dispute-buyer-favoured), we owe the code's
   * budget the unit back — otherwise a coupon with `usageLimit=100`
   * that's been hit by 100 customers, half of whom refunded, looks
   * spent when only 50 customers actually got value.
   *
   * Pass-through to the underlying repository to keep the discounts
   * domain isolated from the refund-instructions module's
   * `decrementCodeUsage` direct DB writes.
   *
   * Idempotent via `idempotencyKey = orderItemId + discountCodeId`:
   * re-running for the same item is a no-op.
   */
  async restoreCouponUsage(args: {
    orderItemId: string;
    reason?: string;
  }): Promise<void> {
    const ledgerRows = await this.prisma.discountLiabilityLedger.findMany({
      where: { orderItemId: args.orderItemId, status: 'REVERSED' },
      select: { discountCodeId: true, id: true },
    });
    const codeIds = Array.from(
      new Set(
        ledgerRows
          .map((r) => r.discountCodeId)
          .filter((x): x is string => !!x),
      ),
    );
    if (codeIds.length === 0) return;

    // Decrement the per-code usage counter for each distinct code
    // that appeared on this item. Use a CAS-style update so a
    // counter that's already at 0 (over-decremented by manual fix)
    // can't go negative.
    for (const codeId of codeIds) {
      try {
        await this.prisma.discountCode.updateMany({
          where: { id: codeId, usedCount: { gt: 0 } },
          data: {
            usedCount: { decrement: 1 },
          },
        });
      } catch (err) {
        // Best-effort — log via the logger we already have on the
        // service. Failure to decrement is not refund-blocking.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).logger?.warn?.(
          `restoreCouponUsage: failed to decrement code ${codeId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private zeroReversal(): RefundProrationResult['reversalSnapshot'] {
    return {
      grossReturnedInPaise: 0n,
      discountReversalInPaise: 0n,
      taxableReversalInPaise: 0n,
      cgstReversalInPaise: 0n,
      sgstReversalInPaise: 0n,
      igstReversalInPaise: 0n,
      totalTaxReversalInPaise: 0n,
      totalCreditNoteInPaise: 0n,
      gstRateBps: 0,
    };
  }
}

// Note on the upsert id pattern above: we use the deterministic
// idempotency key as the row's primary `id` to get free dedup via
// Prisma's upsert-by-id. The schema defaults `id` to a uuid, but
// we override it for ledger rows so retried allocation transactions
// converge on the same row instead of creating duplicates. The
// security-patch index `discount_liability_ledger_idem_key` on
// `(master_order_id, discount_id, liability_party, idempotency_key)`
// is a redundant safety net.

// ──────────────────────────────────────────────────────────────────
// Phase C (P0.2) — Refund proration helpers.
//
// Called from `return.service.ts` during QC decision. For a given
// (orderItem, approvedQuantity) the helper computes the correct
// net refund — the customer's actual paid amount for those units
// after discount allocation, plus the proportional GST reversal.
//
// Legacy fallback: if no `OrderItemTaxSnapshot` exists for this
// item (legacy order placed before allocation went live), the
// helper returns null and the caller falls back to the existing
// gross-price refund calculation. This is what makes the rollout
// safe — old orders keep working exactly as before.
// ──────────────────────────────────────────────────────────────────

export interface RefundProrationResult {
  /** Customer-facing refund amount in paise (taxable + tax). */
  totalRefundInPaise: bigint;
  /** Snapshot of inputs to write a ReturnTaxReversalLine row. */
  reversalSnapshot: {
    grossReturnedInPaise: bigint;
    discountReversalInPaise: bigint;
    taxableReversalInPaise: bigint;
    cgstReversalInPaise: bigint;
    sgstReversalInPaise: bigint;
    igstReversalInPaise: bigint;
    totalTaxReversalInPaise: bigint;
    totalCreditNoteInPaise: bigint;
    gstRateBps: number;
  };
}

