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

import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { SupplyTaxability } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  calculateLineTax,
  type TaxabilityName,
} from '../../domain/tax-engine';
import { computeInvoiceRoundOff } from '../../domain/round-off';
import { allocateOrderLevel } from '../../../discounts/domain/allocation/allocate';
import { TaxModeService } from './tax-mode.service';

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
  /**
   * Phase 65 (2026-05-22) — applied-coupon discount surface (audit
   * Gaps #1 + #21). Pre-Phase-65 the preview hard-coded
   * `discountInPaise: 0n` per line, so the tax shown overstated
   * the real invoice tax whenever a coupon was applied. The new
   * path accepts the total discount in paise + the eligible product
   * ids + the tax treatment, runs the canonical
   * `allocateOrderLevel` proportional split, and feeds the
   * per-item allocated discount through to `calculateLineTax`.
   * Result: preview and snapshot agree byte-for-byte.
   */
  discount?: {
    totalInPaise: bigint;
    /** When supplied, allocation is restricted to the listed
     *  productIds (mirrors AMOUNT_OFF_PRODUCTS / specific-product
     *  rules). Empty = all items eligible. */
    eligibleProductIds?: ReadonlySet<string>;
    /** Mirrors the Discount.taxTreatment field; non-pre-supply
     *  treatments produce tax math identical to the no-discount
     *  case (the engine sees gross). */
    taxTreatment?:
      | 'PRE_SUPPLY_TRANSACTIONAL'
      | 'POST_SUPPLY_LINKED'
      | 'POST_SUPPLY_UNLINKED'
      | 'DISPLAY_ONLY';
  };
}

// Phase 36 — per-line drill-down. The cart/checkout UI uses this to
// expand a line and show its CGST/SGST/IGST/cess share. Numbers are
// all stringified BigInt-paise to keep the wire shape consistent
// with the aggregate fields.
export interface CheckoutTaxPreviewLine {
  /**
   * Phase 65 (2026-05-22) — composite key for UI matching (audit
   * Gap #14). Pre-Phase-65 the UI relied on positional index
   * alignment; any future reorder (e.g. saved-for-later filter)
   * would silently display wrong tax against the wrong row. The
   * composite key is `${productId}:${variantId ?? ''}` and is
   * stable across reorders.
   */
  lineKey: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  /** Per-unit price in paise (mirror of the input value). */
  unitPriceInPaise: string;
  /** Subtotal of the line BEFORE tax (gross when tax-exclusive, or
   *  gross minus embedded tax when tax-inclusive). */
  taxableInPaise: string;
  /** Phase 65 — proportional discount allocated to this line in
   *  paise (audit Gap #21). 0 when no coupon applied. Mirrors the
   *  amount the snapshot path would record under
   *  PRE_SUPPLY_TRANSACTIONAL. */
  discountInPaise: string;
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
  /**
   * Phase 65 (2026-05-22) — productIds that couldn't be loaded
   * from the catalog (e.g. soft-deleted or archived between cart-
   * add and preview) (audit Gap #17). UI can surface these as
   * "Item unavailable" rather than silently showing 0 tax.
   */
  missingItemIds: string[];
  /**
   * Phase 65 (2026-05-22) — server timestamp of the compute
   * (audit Gap #23). Lets the UI invalidate a stale render when
   * the cart changes mid-flow.
   */
  previewedAt: string;
  /**
   * Phase 65 (2026-05-22) — deterministic hash of the preview
   * inputs (cart contents + address + coupon + tax profile). The
   * UI re-fetches when the cart changes and compares against the
   * last-known hash; a mismatch means the customer is looking at
   * a stale preview and the place-order button is dimmed until
   * the new preview returns (audit Gap #23).
   */
  inputHash: string;
}

@Injectable()
export class CheckoutTaxPreviewService {
  private readonly logger = new Logger(CheckoutTaxPreviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Phase 65 (2026-05-22) — STRICT mode gate (audit Gaps #3 + #11
    // + #12 + #13). Pre-Phase-65 the preview silently used schema
    // defaults (taxInclusivePricing=true, supplyTaxability=TAXABLE,
    // gstRateBps=0) when a product was missing tax config; the
    // customer saw ₹0 GST on a TAXABLE product. STRICT mode now
    // surfaces a TaxStrictModeViolationError; AUDIT logs; OFF
    // preserves the old behaviour for dev.
    private readonly taxMode: TaxModeService,
  ) {}

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
              // Phase 65 (2026-05-22) — filter inactive / soft-deleted
              // products (audit Gap #16). Pre-Phase-65 an archived
              // product still got taxed at its stale gstRateBps; the
              // customer saw tax for something they can't actually
              // checkout. Missing products are reported via
              // missingItemIds[].
              where: { id: { in: productIds }, status: 'ACTIVE', isDeleted: false },
              select: {
                id: true,
                hsnCode: true,
                gstRateBps: true,
                supplyTaxability: true,
                taxInclusivePricing: true,
                cessRateBps: true,
                // Phase 65 (audit Gap #13) — surface
                // taxConfigVerified so STRICT mode can refuse to
                // preview an un-attested TAXABLE product.
                taxConfigVerified: true,
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
    // Phase 65 (2026-05-22) — products that didn't resolve from
    // catalog (audit Gap #17). Soft-deleted / archived products are
    // already filtered by the `status='ACTIVE'` clause above; this
    // tracks the resulting absence in the productById map.
    const missingItemIds: string[] = [];
    // Phase 36 — per-line drill-down for the cart/checkout expand UI.
    const lines: CheckoutTaxPreviewLine[] = [];

    // Phase 65 (audit Gaps #1 + #21) — discount allocation. Use the
    // canonical allocateOrderLevel domain function so preview and
    // snapshot agree byte-for-byte. Only run when a coupon is
    // applied AND the discount is PRE_SUPPLY_TRANSACTIONAL (the
    // only treatment that affects taxable value); other treatments
    // pass through with 0 discount per line, matching the snapshot.
    const discountByLineIdx = new Map<number, bigint>();
    if (
      input.discount &&
      input.discount.totalInPaise > 0n &&
      (input.discount.taxTreatment ?? 'PRE_SUPPLY_TRANSACTIONAL') ===
        'PRE_SUPPLY_TRANSACTIONAL'
    ) {
      const allocatorItems = input.items.map((it, idx) => ({
        // Synthesize a stable id from the line index — the
        // allocator only needs string identity, not a real
        // OrderItem row.
        orderItemId: `preview-${idx}`,
        productId: it.productId,
        variantId: it.variantId ?? null,
        subOrderId: 'preview',
        sellerId: it.sellerId ?? null,
        grossInPaise: it.unitPriceInPaise * BigInt(it.quantity),
        unitPriceInPaise: it.unitPriceInPaise,
        quantity: it.quantity,
      }));
      const eligibleSet = input.discount.eligibleProductIds;
      try {
        const alloc = allocateOrderLevel({
          items: allocatorItems,
          totalDiscountInPaise: input.discount.totalInPaise,
          eligibleProductIds:
            eligibleSet && eligibleSet.size > 0
              ? new Set(eligibleSet)
              : undefined,
        });
        const allocByOrderItemId = new Map(
          alloc.allocations.map((a) => [a.orderItemId, a.discountInPaise]),
        );
        allocatorItems.forEach((ai, idx) => {
          const d = allocByOrderItemId.get(ai.orderItemId) ?? 0n;
          if (d > 0n) discountByLineIdx.set(idx, d);
        });
      } catch (err) {
        // Allocator throws when no eligible items / zero gross.
        // Preview should still produce a tax breakdown (just
        // without the discount); a logger.warn lets ops see the
        // edge case.
        this.logger.warn(
          `Discount allocation failed in preview: ${(err as Error).message}. Falling back to no-discount preview.`,
        );
      }
    }

    for (let idx = 0; idx < input.items.length; idx++) {
      const it = input.items[idx]!;
      const product = productById.get(it.productId);
      const variant = it.variantId
        ? variantById.get(it.variantId)
        : null;

      // Phase 65 (audit Gap #17) — explicitly track missing
      // products separately from the per-line "incomplete" hint.
      if (!product) {
        missingItemIds.push(it.productId);
      }

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

      // Phase 65 (audit Gaps #1 + #21) — proportional discount.
      const lineDiscountInPaise = discountByLineIdx.get(idx) ?? 0n;

      const tax = calculateLineTax({
        grossInPaise,
        discountInPaise: lineDiscountInPaise,
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

      // Phase 65 (audit Gaps #3 + #11 + #12 + #13) — STRICT mode
      // gate. Any condition that pre-Phase-65 fell through to a
      // schema default now raises a TaxModeViolation; the
      // TaxModeService decides whether to log (AUDIT) or throw
      // (STRICT). OFF mode preserves the pre-Phase-65 silent
      // fallback for dev.
      if (!product) {
        await this.taxMode.report({
          code: 'tax_preview.product_missing',
          message: `Product ${it.productId} not found in catalog for tax preview`,
          context: { productId: it.productId, variantId: it.variantId },
        });
      } else if (isTaxable && !hasCompleteConfig) {
        await this.taxMode.report({
          code: 'tax_preview.taxable_without_hsn_or_rate',
          message: `TAXABLE product ${it.productId} missing HSN code or non-zero rate`,
          context: {
            productId: it.productId,
            variantId: it.variantId,
            hsnCode: variant?.hsnCodeOverride ?? product.hsnCode,
            gstRateBps,
          },
        });
      } else if (isTaxable && !product.taxConfigVerified) {
        // Phase 65 (audit Gap #13) — taxConfigVerified is the
        // admin-attested signal that the rate + HSN are correct.
        // Un-attested TAXABLE products are previewed in OFF/AUDIT
        // mode (with a logged violation) but blocked in STRICT.
        await this.taxMode.report({
          code: 'tax_preview.tax_config_unverified',
          message: `TAXABLE product ${it.productId} has not been admin-attested`,
          context: { productId: it.productId },
        });
      }

      // Phase 65 (audit Gap #14) — composite line key for the UI.
      const lineKey = `${it.productId}:${it.variantId ?? ''}`;

      // Phase 36 — record the per-line breakdown for the drill-down UI.
      lines.push({
        lineKey,
        productId: it.productId,
        variantId: it.variantId,
        quantity: it.quantity,
        unitPriceInPaise: it.unitPriceInPaise.toString(),
        taxableInPaise: tax.taxableInPaise.toString(),
        discountInPaise: lineDiscountInPaise.toString(),
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

    // Phase 65 (audit Gap #23) — input hash so the UI can
    // invalidate a stale render. Deterministic over the inputs
    // that affect the tax math (items + address + coupon + tax
    // profile). Hex digest is fine: collision risk is moot since
    // the only consumer is "did anything change?" comparison.
    const inputHash = createHash('sha256')
      .update(
        JSON.stringify({
          items: input.items.map((it) => ({
            p: it.productId,
            v: it.variantId,
            q: it.quantity,
            u: it.unitPriceInPaise.toString(),
            s: it.sellerId,
          })),
          state: input.customerShippingStateCode,
          discount: input.discount
            ? {
                t: input.discount.totalInPaise.toString(),
                e: input.discount.eligibleProductIds
                  ? [...input.discount.eligibleProductIds].sort()
                  : null,
                tt: input.discount.taxTreatment ?? null,
              }
            : null,
        }),
      )
      .digest('hex');

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
      missingItemIds,
      previewedAt: new Date().toISOString(),
      inputHash,
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
    missingItemIds: [],
    previewedAt: new Date().toISOString(),
    inputHash: createHash('sha256').update('empty').digest('hex'),
  };
}
