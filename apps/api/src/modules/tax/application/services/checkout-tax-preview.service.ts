// Phase 30 — CheckoutTaxPreviewService.
//
// Returns a tax breakdown for a checkout session WITHOUT persisting
// anything. The customer sees the same CGST/SGST/IGST split at
// checkout that the post-placement invoice carries, removing the
// "GST: Included in price" black box.
//
// This service does the same per-line math as TaxSnapshotService
// (Phase 6) but operates on an in-memory item list rather than
// committed order rows. It does not write order_item_tax_snapshots
// or sub_order_tax_summary — placeOrder() does that authoritatively
// after the cart commits.
//
// Conservative on missing data:
//   - Customer state code unknown → treat shipping as inter-state
//     (IGST). Worst case the customer sees a slightly different
//     split at checkout vs. invoice for unusual addresses; both
//     sums are equal so the total amount is correct.
//   - Seller state code unknown → same fallback.
//   - Product missing tax fields → use schema defaults (0% GST,
//     TAXABLE) so the preview at least sums correctly. The audit-
//     readiness scan flags these products separately.
//
// See:
//   - apps/api/src/modules/tax/domain/tax-engine.ts
//   - apps/api/src/modules/tax/domain/place-of-supply.ts
//   - apps/api/src/modules/tax/domain/round-off.ts

import { Injectable, Logger } from '@nestjs/common';
import type { SupplyTaxability } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  calculateLineTax,
  type TaxabilityName,
} from '../../domain/tax-engine';
import { computeInvoiceRoundOff } from '../../domain/round-off';

export interface CheckoutTaxPreviewItem {
  productId: string;
  variantId: string | null;
  /** Per-item unit price in paise. Whether this is GST-inclusive or
   *  GST-exclusive is determined by the product's `taxInclusivePricing`
   *  field — the service does NOT trust the caller on that point. */
  unitPriceInPaise: bigint;
  quantity: number;
  /** Seller fulfilling this line. Determines the supplier state code
   *  for the place-of-supply decision. Null for platform-owned
   *  fulfilment (OWN_BRAND / SPORTSMART) — supplier state then comes
   *  from the platform GST profile. */
  sellerId: string | null;
}

export interface CheckoutTaxPreviewInput {
  items: CheckoutTaxPreviewItem[];
  /** Customer shipping state — 2-digit GST code if known; the service
   *  falls back to inter-state IGST when null. */
  customerShippingStateCode: string | null;
}

// Phase 36 — per-line drill-down. The cart/checkout UI uses this to
// expand a line and show its CGST/SGST/IGST/cess share. Numbers are
// all stringified BigInt-paise to keep the wire shape consistent
// with the aggregate fields.
export interface CheckoutTaxPreviewLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  /** Per-unit price in paise (mirror of the input value). */
  unitPriceInPaise: string;
  /** Subtotal of the line BEFORE tax (gross when tax-exclusive, or
   *  gross minus embedded tax when tax-inclusive). */
  taxableInPaise: string;
  cgstInPaise: string;
  sgstInPaise: string;
  igstInPaise: string;
  cessInPaise: string;
  /** Effective applied GST rate in basis points (e.g. 1800 = 18%). */
  gstRateBps: number;
  cessRateBps: number;
  /** Did the line resolve to intra-state (CGST+SGST) or inter-state
   *  (IGST)? Mirrors the engine's place-of-supply decision so the UI
   *  can show "CGST 9% + SGST 9%" vs "IGST 18%" alongside the value. */
  isIntraState: boolean;
  /** TAXABLE / NIL_RATED / EXEMPT / NON_GST / ZERO_RATED / OUT_OF_SCOPE.
   *  Matches the product's declared taxability — the UI can use it to
   *  show "Exempt — no GST" instead of "₹0 CGST". */
  supplyTaxability: TaxabilityName;
  /** True when this line landed at zero tax because the product was
   *  marked TAXABLE but missing HSN / rate. Surfaces the "GST may
   *  differ on final invoice" hint at the line level. */
  isIncomplete: boolean;
}

export interface CheckoutTaxPreviewResult {
  subtotalTaxableInPaise: string;
  cgstInPaise: string;
  sgstInPaise: string;
  igstInPaise: string;
  cessInPaise: string;
  totalTaxInPaise: string;
  /** Pre-round-off sum (subtotal + tax + cess). Stringified BigInt. */
  rawTotalInPaise: string;
  /** Signed round-off adjustment to reach the customer-facing whole-
   *  rupee figure. Positive = customer pays more, negative = less. */
  roundOffInPaise: string;
  grandTotalInPaise: string;
  /** True when at least one item shipped through IGST — useful for
   *  the UI to decide whether to render CGST+SGST OR IGST rows. */
  hasIgst: boolean;
  hasCgstSgst: boolean;
  /** Items that couldn't resolve a complete tax config (missing HSN
   *  / rate) and therefore landed at zero tax. Surfaced so the
   *  frontend can render a "GST may differ on final invoice" hint
   *  rather than misleading the customer. */
  incompleteItemCount: number;
  /** Phase 36 — per-line tax breakdown, in the same order as the
   *  input items. Lets the UI expand a cart line and see what tax
   *  drove the totals. */
  lines: CheckoutTaxPreviewLine[];
}

@Injectable()
export class CheckoutTaxPreviewService {
  private readonly logger = new Logger(CheckoutTaxPreviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async previewForSession(
    input: CheckoutTaxPreviewInput,
  ): Promise<CheckoutTaxPreviewResult> {
    if (input.items.length === 0) {
      return zeroPreview();
    }

    // 1. Batch-load products + variants + sellers + platform profile.
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const variantIds = [
      ...new Set(
        input.items
          .map((i) => i.variantId)
          .filter((v): v is string => !!v),
      ),
    ];
    const sellerIds = [
      ...new Set(
        input.items
          .map((i) => i.sellerId)
          .filter((s): s is string => !!s),
      ),
    ];

    const [products, variants, sellers, platformProfile] =
      await Promise.all([
        productIds.length > 0
          ? this.prisma.product.findMany({
              where: { id: { in: productIds } },
              select: {
                id: true,
                hsnCode: true,
                gstRateBps: true,
                supplyTaxability: true,
                taxInclusivePricing: true,
                cessRateBps: true,
              },
            })
          : Promise.resolve([]),
        variantIds.length > 0
          ? this.prisma.productVariant.findMany({
              where: { id: { in: variantIds } },
              select: {
                id: true,
                hsnCodeOverride: true,
                gstRateBpsOverride: true,
                taxInclusivePricingOverride: true,
              },
            })
          : Promise.resolve([]),
        sellerIds.length > 0
          ? this.prisma.seller.findMany({
              where: { id: { in: sellerIds } },
              select: { id: true, gstStateCode: true },
            })
          : Promise.resolve([]),
        this.prisma.platformGstProfile.findFirst({
          where: { isDefault: true, isActive: true },
          select: { gstStateCode: true },
        }),
      ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const sellerStateById = new Map(
      sellers.map((s) => [s.id, s.gstStateCode]),
    );
    const platformStateCode = platformProfile?.gstStateCode ?? null;

    // 2. Per-item: derive tax config, resolve POS, compute tax.
    let subtotalTaxable = 0n;
    let totalCgst = 0n;
    let totalSgst = 0n;
    let totalIgst = 0n;
    let totalCess = 0n;
    let hasIgst = false;
    let hasCgstSgst = false;
    let incompleteItemCount = 0;
    // Phase 36 — per-line drill-down for the cart/checkout expand UI.
    const lines: CheckoutTaxPreviewLine[] = [];

    for (const it of input.items) {
      const product = productById.get(it.productId);
      const variant = it.variantId
        ? variantById.get(it.variantId)
        : null;

      const gstRateBps =
        variant?.gstRateBpsOverride ??
        product?.gstRateBps ??
        0;
      const cessRateBps = product?.cessRateBps ?? 0;
      const supplyTaxability = ((product?.supplyTaxability ??
        'TAXABLE') as SupplyTaxability) as TaxabilityName;
      const priceIncludesTax =
        variant?.taxInclusivePricingOverride ??
        product?.taxInclusivePricing ??
        true;

      // Place-of-supply: supplier state from seller (or platform if
      // OWN_BRAND), customer state from shipping address. Fallback
      // to IGST when either is missing.
      const supplierStateCode =
        (it.sellerId && sellerStateById.get(it.sellerId)) ||
        platformStateCode ||
        null;
      const isIntraState =
        !!supplierStateCode &&
        !!input.customerShippingStateCode &&
        supplierStateCode === input.customerShippingStateCode;

      const grossInPaise =
        it.unitPriceInPaise * BigInt(it.quantity);

      const tax = calculateLineTax({
        grossInPaise,
        // Cart discount allocation runs at placeOrder time; the
        // preview deliberately doesn't try to second-guess it. If
        // the customer applied a coupon, the post-placement invoice
        // will reflect a slightly lower subtotal — banner copy
        // tells them.
        discountInPaise: 0n,
        gstRateBps,
        cessRateBps,
        priceIncludesTax,
        isIntraState,
        supplyTaxability,
      });

      subtotalTaxable += tax.taxableInPaise;
      totalCgst += tax.cgstInPaise;
      totalSgst += tax.sgstInPaise;
      totalIgst += tax.igstInPaise;
      totalCess += tax.cessInPaise;
      if (tax.cgstInPaise > 0n || tax.sgstInPaise > 0n) hasCgstSgst = true;
      if (tax.igstInPaise > 0n) hasIgst = true;

      // "Incomplete" = TAXABLE but no HSN/rate. Doesn't block the
      // preview but surfaces a "GST shown is best-effort" hint.
      const isTaxable =
        supplyTaxability === 'TAXABLE' ||
        supplyTaxability === 'ZERO_RATED';
      const hasCompleteConfig =
        (variant?.hsnCodeOverride ?? product?.hsnCode) != null &&
        gstRateBps > 0;
      const lineIncomplete = isTaxable && !hasCompleteConfig;
      if (lineIncomplete) {
        incompleteItemCount++;
      }

      // Phase 36 — record the per-line breakdown for the drill-down UI.
      lines.push({
        productId: it.productId,
        variantId: it.variantId,
        quantity: it.quantity,
        unitPriceInPaise: it.unitPriceInPaise.toString(),
        taxableInPaise: tax.taxableInPaise.toString(),
        cgstInPaise: tax.cgstInPaise.toString(),
        sgstInPaise: tax.sgstInPaise.toString(),
        igstInPaise: tax.igstInPaise.toString(),
        cessInPaise: tax.cessInPaise.toString(),
        gstRateBps,
        cessRateBps,
        isIntraState,
        supplyTaxability,
        isIncomplete: lineIncomplete,
      });
    }

    const totalTax = totalCgst + totalSgst + totalIgst;
    const rawTotal = subtotalTaxable + totalTax + totalCess;
    const roundOff = computeInvoiceRoundOff(rawTotal);

    if (incompleteItemCount > 0) {
      this.logger.warn(
        `Checkout tax preview: ${incompleteItemCount} item(s) had ` +
          `incomplete tax config (missing HSN or rate) and were ` +
          `previewed at 0 GST. The final invoice will reflect ` +
          `whatever the merchant updates before placeOrder.`,
      );
    }

    return {
      subtotalTaxableInPaise: subtotalTaxable.toString(),
      cgstInPaise: totalCgst.toString(),
      sgstInPaise: totalSgst.toString(),
      igstInPaise: totalIgst.toString(),
      cessInPaise: totalCess.toString(),
      totalTaxInPaise: totalTax.toString(),
      rawTotalInPaise: rawTotal.toString(),
      roundOffInPaise: roundOff.roundOffInPaise.toString(),
      grandTotalInPaise: roundOff.roundedAmountInPaise.toString(),
      hasIgst,
      hasCgstSgst,
      incompleteItemCount,
      lines,
    };
  }
}

function zeroPreview(): CheckoutTaxPreviewResult {
  return {
    subtotalTaxableInPaise: '0',
    cgstInPaise: '0',
    sgstInPaise: '0',
    igstInPaise: '0',
    cessInPaise: '0',
    totalTaxInPaise: '0',
    rawTotalInPaise: '0',
    roundOffInPaise: '0',
    grandTotalInPaise: '0',
    hasIgst: false,
    hasCgstSgst: false,
    incompleteItemCount: 0,
    lines: [],
  };
}
