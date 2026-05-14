// Phase 6 of the GST/tax/invoice system — TaxSnapshotService.
//
// Owns creation of:
//   - OrderItemTaxSnapshot rows  (one per OrderItem)
//   - SubOrderTaxSummary rows    (one per SubOrder)
//   - OrderTaxSummary row        (one per MasterOrder)
//
// Why a separate service from DiscountAllocationService:
//   - Snapshots must be written for EVERY order, not only those with
//     a discount. DiscountAllocationService is gated on
//     `discountId && allocationEnabled` so it was skipping the
//     no-discount path.
//   - Phase 7 (shipping GST) + Phase 11 (returns reversal) + Phase 8
//     (invoice generation) all read snapshots; isolating the writer
//     keeps the dependency graph clean.
//
// Idempotency: every write is an upsert keyed on a unique column
// (orderItemId / subOrderId / masterOrderId). A retried call produces
// no duplicates and overwrites with the latest computation.
//
// Reads (no writes):
//   - master_orders + sub_orders + seller/franchise (POS resolver)
//   - order_items (line context)
//   - products + product_variants (HSN/rate/taxability/inclusive/UQC)
//   - order_item_discounts (per-line discount allocated, post Phase 4)
//   - customer_tax_profiles (buyerGstin snapshot if B2B)
//
// Writes:
//   - order_item_tax_snapshots
//   - sub_order_tax_summaries
//   - order_tax_summaries
//
// See docs/tax/CA.md §A Phase 6 log.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  calculateLineTax,
  type TaxabilityName,
} from '../../domain/tax-engine';
import { PlaceOfSupplyService } from './place-of-supply.service';
import { TaxConfigService } from './tax-config.service';
import type { PlaceOfSupplyResult } from '../../domain/place-of-supply';
import {
  Prisma,
  type DiscountTaxTreatment,
  type SupplyTaxability,
} from '@prisma/client';

export interface CreateSnapshotsOptions {
  /**
   * Defaults to PRE_SUPPLY_TRANSACTIONAL. If the order had a coupon,
   * pass the Discount.taxTreatment value here so the engine knows
   * whether to subtract the discount from taxable value.
   */
  taxTreatment?: DiscountTaxTreatment;
}

@Injectable()
export class TaxSnapshotService {
  private readonly logger = new Logger(TaxSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly placeOfSupply: PlaceOfSupplyService,
    // Phase 7 — shipping SAC + rate + inclusive flag come from
    // tax_config (admin-tunable).
    private readonly taxConfig: TaxConfigService,
  ) {}

  /**
   * Compute and persist all tax artefacts for a MasterOrder.
   * Safe to call multiple times — upserts on unique keys.
   *
   * Sequence:
   *   1. Resolve place-of-supply per sub-order (outside tx — reads
   *      committed master_order / sub_order / seller / franchise data).
   *   2. Open a tx.
   *   3. Load items + their per-line discount allocations.
   *   4. Load products + variants in batch.
   *   5. For each item, run the engine v2 → upsert snapshot row.
   *   6. Aggregate per-sub-order → upsert SubOrderTaxSummary.
   *   7. Roll up → upsert OrderTaxSummary.
   */
  async createSnapshotsForMasterOrder(
    masterOrderId: string,
    options: CreateSnapshotsOptions = {},
  ): Promise<void> {
    const taxTreatment: DiscountTaxTreatment =
      options.taxTreatment ?? 'PRE_SUPPLY_TRANSACTIONAL';

    // 1. POS resolver — reads committed master_order/sub_orders.
    let posMap: Map<string, PlaceOfSupplyResult>;
    try {
      posMap = await this.placeOfSupply.resolveForMasterOrder(masterOrderId);
    } catch (err) {
      this.logger.error(
        `POS resolution failed for order ${masterOrderId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    // 1b. Buyer GSTIN — pulled once from customer's default tax profile.
    const buyerGstin = await this.resolveBuyerGstin(masterOrderId);

    await this.prisma.$transaction(async (tx) => {
      // 2. Load items.
      const items = await tx.orderItem.findMany({
        where: { subOrder: { masterOrderId } },
        select: {
          id: true,
          productId: true,
          variantId: true,
          productTitle: true,
          quantity: true,
          subOrderId: true,
          unitPriceInPaise: true,
          totalPriceInPaise: true,
          subOrder: { select: { sellerId: true } },
        },
      });

      if (items.length === 0) {
        this.logger.warn(`No items for master order ${masterOrderId}; nothing to snapshot`);
        return;
      }

      // 3. Per-line allocated discount (from order_item_discounts).
      // Phase 4 wrote these via DiscountAllocationService. Absent rows
      // → zero discount on that line.
      const discountRows = await tx.orderItemDiscount.findMany({
        where: { masterOrderId },
        select: { orderItemId: true, discountAmountInPaise: true },
      });
      const discountByItem = new Map<string, bigint>();
      for (const r of discountRows) {
        const cur = discountByItem.get(r.orderItemId) ?? 0n;
        discountByItem.set(r.orderItemId, cur + r.discountAmountInPaise);
      }

      // 4. Batch product + variant queries.
      const productIds = [...new Set(items.map((i) => i.productId))];
      const variantIds = [
        ...new Set(items.map((i) => i.variantId).filter((v): v is string => !!v)),
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

      // 5. Per-line snapshot loop + per-sub-order accumulator.
      interface SubOrderAccum {
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

      for (const it of items) {
        const pos = posMap.get(it.subOrderId);
        const isIntraState = pos?.isIntraState ?? false;

        const product = productById.get(it.productId);
        const variant = it.variantId ? variantById.get(it.variantId) : null;

        const hsnCode = variant?.hsnCodeOverride ?? product?.hsnCode ?? null;
        const gstRateBps =
          variant?.gstRateBpsOverride ?? product?.gstRateBps ?? 0;
        const cessRateBps = product?.cessRateBps ?? 0;
        const supplyTaxability = ((product?.supplyTaxability as SupplyTaxability) ??
          'TAXABLE') as TaxabilityName;
        const priceIncludesTax =
          variant?.taxInclusivePricingOverride ?? product?.taxInclusivePricing ?? true;
        const uqcCode = variant?.uqcCodeOverride ?? product?.defaultUqcCode ?? null;

        const grossInPaise = BigInt(it.totalPriceInPaise);
        const allocatedDiscount = discountByItem.get(it.id) ?? 0n;
        const effectiveDiscountForTax =
          taxTreatment === 'PRE_SUPPLY_TRANSACTIONAL' ? allocatedDiscount : 0n;

        const tax = calculateLineTax({
          grossInPaise,
          discountInPaise: effectiveDiscountForTax,
          gstRateBps,
          cessRateBps,
          priceIncludesTax,
          isIntraState,
          supplyTaxability,
        });

        const supplierType =
          product?.productSource === 'OWN_BRAND'
            ? ('OWN_BRAND' as const)
            : ('MARKETPLACE_SELLER' as const);

        let taxDataStatus: 'COMPLETE' | 'INCOMPLETE' | 'EXEMPT';
        if (
          supplyTaxability === 'NIL_RATED' ||
          supplyTaxability === 'EXEMPT' ||
          supplyTaxability === 'NON_GST' ||
          supplyTaxability === 'OUT_OF_SCOPE'
        ) {
          taxDataStatus = 'EXEMPT';
        } else if (!hsnCode || gstRateBps <= 0) {
          taxDataStatus = 'INCOMPLETE';
        } else {
          taxDataStatus = 'COMPLETE';
        }

        await tx.orderItemTaxSnapshot.upsert({
          where: { orderItemId: it.id },
          create: {
            masterOrderId,
            subOrderId: it.subOrderId,
            orderItemId: it.id,
            lineType: 'PRODUCT',
            supplierType,
            sellerId: it.subOrder.sellerId,
            productId: it.productId,
            variantId: it.variantId,
            description: it.productTitle,
            uqcCode,
            quantity: new Prisma.Decimal(it.quantity),
            grossLineAmountInPaise: tax.grossInPaise,
            discountAmountInPaise: allocatedDiscount,
            taxableAmountInPaise: tax.taxableInPaise,
            gstRateBps: tax.gstRateBps,
            supplyTaxability: supplyTaxability as SupplyTaxability,
            priceIncludesTax,
            cessRateBps,
            cessAmountInPaise: tax.cessInPaise,
            cgstAmountInPaise: tax.cgstInPaise,
            sgstAmountInPaise: tax.sgstInPaise,
            igstAmountInPaise: tax.igstInPaise,
            totalTaxAmountInPaise: tax.totalTaxInPaise,
            lineTotalAfterDiscountAndTaxInPaise: tax.lineTotalInPaise,
            hsnCode,
            sellerStateCode: pos?.supplierStateCode ?? null,
            placeOfSupply: pos?.placeOfSupplyStateCode ?? null,
            taxSplitType: pos?.taxSplitType ?? null,
            reverseChargeApplicable: false,
            currencyCode: 'INR',
            taxDataStatus,
            buyerGstin,
          },
          update: {
            lineType: 'PRODUCT',
            supplierType,
            sellerId: it.subOrder.sellerId,
            productId: it.productId,
            variantId: it.variantId,
            description: it.productTitle,
            uqcCode,
            quantity: new Prisma.Decimal(it.quantity),
            grossLineAmountInPaise: tax.grossInPaise,
            discountAmountInPaise: allocatedDiscount,
            taxableAmountInPaise: tax.taxableInPaise,
            gstRateBps: tax.gstRateBps,
            supplyTaxability: supplyTaxability as SupplyTaxability,
            priceIncludesTax,
            cessRateBps,
            cessAmountInPaise: tax.cessInPaise,
            cgstAmountInPaise: tax.cgstInPaise,
            sgstAmountInPaise: tax.sgstInPaise,
            igstAmountInPaise: tax.igstInPaise,
            totalTaxAmountInPaise: tax.totalTaxInPaise,
            lineTotalAfterDiscountAndTaxInPaise: tax.lineTotalInPaise,
            hsnCode,
            sellerStateCode: pos?.supplierStateCode ?? null,
            placeOfSupply: pos?.placeOfSupplyStateCode ?? null,
            taxSplitType: pos?.taxSplitType ?? null,
            reverseChargeApplicable: false,
            currencyCode: 'INR',
            taxDataStatus,
            buyerGstin,
          },
        });

        // Accumulate per sub-order
        let accum = subOrderAccums.get(it.subOrderId);
        if (!accum) {
          accum = {
            sellerId: it.subOrder.sellerId,
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

      // Phase 7 GST — shipping allocation + SHIPPING snapshot per sub-order.
      // Shipping fee is recorded on MasterOrder.shippingFeeInPaise as
      // a single value for the whole order. We allocate it across
      // sub-orders proportionally to each sub-order's product
      // taxable value; the last sub-order absorbs the rounding
      // remainder so the sum matches the master fee exactly.
      const master = await tx.masterOrder.findUnique({
        where: { id: masterOrderId },
        select: { shippingFeeInPaise: true },
      });
      const shippingFeeInPaise = master?.shippingFeeInPaise ?? 0n;

      if (shippingFeeInPaise > 0n && subOrderAccums.size > 0) {
        const shippingSac = await this.taxConfig.getString('shipping_sac_code', '9968');
        const shippingRateBps = await this.taxConfig.getNumber('shipping_gst_rate_bps', 1800);
        const shippingInclusive = await this.taxConfig.getBoolean('shipping_tax_inclusive', false);

        // Total product taxable across the order — denominator for the
        // proportional split.
        let masterProductTaxable = 0n;
        for (const a of subOrderAccums.values()) masterProductTaxable += a.taxableInPaise;

        const subOrderIds = [...subOrderAccums.keys()];
        let allocatedSoFar = 0n;

        for (let i = 0; i < subOrderIds.length; i++) {
          const subOrderId = subOrderIds[i];
          const accum = subOrderAccums.get(subOrderId)!;
          const isLast = i === subOrderIds.length - 1;

          // Allocate proportionally; last sub-order absorbs any
          // floor-rounding remainder to guarantee conservation.
          let allocatedShipping: bigint;
          if (masterProductTaxable > 0n) {
            allocatedShipping = isLast
              ? shippingFeeInPaise - allocatedSoFar
              : (shippingFeeInPaise * accum.taxableInPaise) / masterProductTaxable;
          } else {
            // All-exempt order with shipping fee — even split.
            const n = BigInt(subOrderIds.length);
            const baseShare = shippingFeeInPaise / n;
            const remainder = shippingFeeInPaise - baseShare * n;
            allocatedShipping = isLast ? baseShare + remainder : baseShare;
          }
          allocatedSoFar += allocatedShipping;
          if (allocatedShipping <= 0n) continue;

          const tax = calculateLineTax({
            grossInPaise: allocatedShipping,
            discountInPaise: 0n,
            gstRateBps: shippingRateBps,
            cessRateBps: 0,
            priceIncludesTax: shippingInclusive,
            // Shipping follows the same POS split as the product lines
            // in this sub-order (per CA default — configurable later).
            isIntraState: accum.taxSplitType === 'CGST_SGST',
            supplyTaxability: 'TAXABLE',
          });

          // Upsert via findFirst+create/update — orderItemId is NULL
          // for SHIPPING, so we use the partial-unique (subOrderId,
          // lineType) WHERE lineType != 'PRODUCT' index for dedup.
          const existing = await tx.orderItemTaxSnapshot.findFirst({
            where: { subOrderId, lineType: 'SHIPPING' },
          });

          const shippingSnapshotData = {
            masterOrderId,
            subOrderId,
            orderItemId: null,
            lineType: 'SHIPPING' as const,
            // Inherit sub-order context (so the shipping line gets the
            // same supplier identity as the product lines on the same
            // invoice). Phase 25 may revisit if shipping is invoiced
            // separately by the platform.
            supplierType: accum.supplierType ?? undefined,
            sellerId: accum.sellerId,
            productId: null,
            variantId: null,
            description: 'Shipping & Handling',
            // OTH = "OTHERS" per CBIC UQC list; shipping has no
            // physical unit. Could also be NOS.
            uqcCode: 'OTH',
            quantity: new Prisma.Decimal(1),
            grossLineAmountInPaise: tax.grossInPaise,
            discountAmountInPaise: 0n,
            taxableAmountInPaise: tax.taxableInPaise,
            gstRateBps: tax.gstRateBps,
            supplyTaxability: 'TAXABLE' as SupplyTaxability,
            priceIncludesTax: shippingInclusive,
            cessRateBps: 0,
            cessAmountInPaise: 0n,
            cgstAmountInPaise: tax.cgstInPaise,
            sgstAmountInPaise: tax.sgstInPaise,
            igstAmountInPaise: tax.igstInPaise,
            totalTaxAmountInPaise: tax.totalTaxInPaise,
            lineTotalAfterDiscountAndTaxInPaise: tax.lineTotalInPaise,
            // SAC code lives in the hsnCode column (the column is
            // semantically "hsn or sac"); the invoice renderer in
            // Phase 9 will label it correctly per lineType.
            hsnCode: shippingSac,
            sellerStateCode: accum.sellerStateCode,
            placeOfSupply: accum.placeOfSupplyStateCode,
            taxSplitType: accum.taxSplitType ?? undefined,
            reverseChargeApplicable: false,
            currencyCode: 'INR',
            taxDataStatus: 'COMPLETE' as const,
            buyerGstin,
          };

          if (existing) {
            await tx.orderItemTaxSnapshot.update({
              where: { id: existing.id },
              data: shippingSnapshotData,
            });
          } else {
            await tx.orderItemTaxSnapshot.create({ data: shippingSnapshotData });
          }

          // Roll shipping totals into the sub-order accumulator so
          // SubOrderTaxSummary (and OrderTaxSummary via the master
          // accum below) reflects shipping correctly.
          accum.taxableInPaise += tax.taxableInPaise;
          accum.cgstInPaise += tax.cgstInPaise;
          accum.sgstInPaise += tax.sgstInPaise;
          accum.igstInPaise += tax.igstInPaise;
          accum.totalTaxInPaise += tax.totalTaxInPaise;
          accum.invoiceTotalInPaise += tax.lineTotalInPaise;
          accum.lineCount += 1;
        }
      }

      // 6. Upsert SubOrderTaxSummary per sub-order.
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

      for (const [subOrderId, a] of subOrderAccums.entries()) {
        const subStatus: 'COMPLETE' | 'INCOMPLETE' | 'EXEMPT' = a.anyIncomplete
          ? 'INCOMPLETE'
          : a.allExempt
            ? 'EXEMPT'
            : 'COMPLETE';

        await tx.subOrderTaxSummary.upsert({
          where: { subOrderId },
          create: {
            masterOrderId,
            subOrderId,
            sellerId: a.sellerId,
            supplierType: a.supplierType ?? undefined,
            sellerStateCode: a.sellerStateCode,
            placeOfSupplyStateCode: a.placeOfSupplyStateCode,
            taxSplitType: a.taxSplitType ?? undefined,
            buyerGstin,
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
            buyerGstin,
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

      // 7. Upsert OrderTaxSummary.
      const masterStatus: 'COMPLETE' | 'INCOMPLETE' | 'EXEMPT' =
        masterAccum.anyIncomplete
          ? 'INCOMPLETE'
          : masterAccum.allExempt
            ? 'EXEMPT'
            : 'COMPLETE';
      await tx.orderTaxSummary.upsert({
        where: { masterOrderId },
        create: {
          masterOrderId,
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
    });
  }

  /**
   * Resolve the buyer's GSTIN to snapshot on every tax row + summary.
   * Returns null for B2C. Reads the customer's default
   * CustomerTaxProfile. Phase 25 adds a checkout-time override.
   */
  private async resolveBuyerGstin(masterOrderId: string): Promise<string | null> {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: masterOrderId },
      select: { customerId: true },
    });
    if (!order) return null;
    const profile = await this.prisma.customerTaxProfile.findFirst({
      where: { customerId: order.customerId, isDefault: true },
      select: { gstin: true },
    });
    return profile?.gstin ?? null;
  }
}
