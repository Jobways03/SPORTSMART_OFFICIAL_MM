import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Phase 44 (2026-05-21) — server-side resolver that picks the
 * best-eligible ProductPricingTier for a (product, variant, qty)
 * triple and returns the effective unit price.
 *
 * Selection rules (decided here, intentionally — pre-Phase-44 the
 * code-base left them documented-as-undefined):
 *
 *   1. Eligibility: isActive=true; tier targets the product (variant
 *      scope OR null-variant scope); qty >= minQuantity; if
 *      maxQuantity is set, qty <= maxQuantity; current time falls in
 *      the [startAt, endAt) schedule window if either bound is set.
 *
 *   2. Precedence at the same minQuantity:
 *        variant-scoped tier > product-scoped tier.
 *      This lets ops layer a variant-specific override on top of a
 *      product-wide ladder.
 *
 *   3. Best-tier-wins by effective discount, not by minQuantity.
 *      Prevents the audit's Gap #9 footgun (admin defines higher
 *      qty band with lower discount → customer at higher qty
 *      gets the worse deal). We evaluate every eligible tier and
 *      pick the one with the lowest effective unit price.
 *
 *   4. fixedUnitPrice vs discountPercent: a tier carries exactly
 *      one. fixedUnitPrice is an absolute override; discountPercent
 *      is applied against the supplied listPrice.
 *
 * Money math uses string-via-Number with round-half-up at 2dp. The
 * domain already settles on Decimal(10,2) at the schema layer; this
 * resolver outputs the same precision.
 */

export interface ResolveArgs {
  productId: string;
  variantId: string | null;
  quantity: number;
  listUnitPrice: number;
  /** ISO timestamp; defaults to "now". Used for the schedule check. */
  at?: Date;
}

export interface ResolveResult {
  effectiveUnitPrice: number;
  appliedTierId: string | null;
  appliedDiscountPercent: number | null;
  appliedFixedUnitPrice: number | null;
  listUnitPrice: number;
}

interface TierRow {
  id: string;
  variantId: string | null;
  minQuantity: number;
  maxQuantity: number | null;
  discountPercent: Prisma.Decimal | null;
  fixedUnitPrice: Prisma.Decimal | null;
  startAt: Date | null;
  endAt: Date | null;
}

@Injectable()
export class PricingResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveUnitPrice(args: ResolveArgs): Promise<ResolveResult> {
    const now = args.at ?? new Date();
    if (args.quantity <= 0 || args.listUnitPrice <= 0) {
      return baseResult(args.listUnitPrice);
    }

    // Single fetch — bounded set per product (typically < 5 tiers).
    const tiers = await this.fetchEligibleTiers(args.productId, args.variantId, now);

    const eligible = tiers.filter((t) => isQtyInBand(t, args.quantity));
    if (eligible.length === 0) return baseResult(args.listUnitPrice);

    return PricingResolutionService.pickBestTier(eligible, args.variantId, args.listUnitPrice);
  }

  /**
   * Resolve a batch of cart lines in one DB round-trip. Used by the
   * cart + checkout services so a 20-line cart doesn't fire 20
   * separate tier queries.
   */
  async resolveBatch(
    items: ReadonlyArray<ResolveArgs>,
    at?: Date,
  ): Promise<ResolveResult[]> {
    if (items.length === 0) return [];
    const now = at ?? new Date();

    // Group by productId so the single DB query covers everything.
    const productIds = Array.from(new Set(items.map((i) => i.productId)));
    const tiers = await this.prisma.productPricingTier.findMany({
      where: {
        productId: { in: productIds },
        isActive: true,
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gt: now } }] }],
      },
      select: {
        id: true, productId: true, variantId: true,
        minQuantity: true, maxQuantity: true,
        discountPercent: true, fixedUnitPrice: true,
        startAt: true, endAt: true,
      },
    });

    const byProduct = new Map<string, TierRow[]>();
    for (const t of tiers) {
      const arr = byProduct.get(t.productId) ?? [];
      arr.push(t);
      byProduct.set(t.productId, arr);
    }

    return items.map((item) => {
      if (item.quantity <= 0 || item.listUnitPrice <= 0) return baseResult(item.listUnitPrice);
      const productTiers = byProduct.get(item.productId) ?? [];
      const candidates = productTiers.filter(
        (t) => (t.variantId === null || t.variantId === item.variantId)
          && isQtyInBand(t, item.quantity),
      );
      if (candidates.length === 0) return baseResult(item.listUnitPrice);
      return PricingResolutionService.pickBestTier(candidates, item.variantId, item.listUnitPrice);
    });
  }

  private async fetchEligibleTiers(
    productId: string,
    variantId: string | null,
    now: Date,
  ): Promise<TierRow[]> {
    const where: Prisma.ProductPricingTierWhereInput = {
      productId,
      isActive: true,
      OR: [
        { variantId: null },
        ...(variantId ? [{ variantId } as Prisma.ProductPricingTierWhereInput] : []),
      ],
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gt: now } }] },
      ],
    };
    return this.prisma.productPricingTier.findMany({
      where,
      select: {
        id: true, variantId: true,
        minQuantity: true, maxQuantity: true,
        discountPercent: true, fixedUnitPrice: true,
        startAt: true, endAt: true,
      },
    });
  }

  /**
   * Pick the best eligible tier. Tie-breaker: variant-scoped beats
   * product-scoped at the same effective price.
   *
   * Exposed as a static so the spec can test it without a Prisma
   * round trip.
   */
  static pickBestTier(
    eligible: ReadonlyArray<Pick<TierRow, 'id' | 'variantId' | 'discountPercent' | 'fixedUnitPrice'>>,
    variantId: string | null,
    listUnitPrice: number,
  ): ResolveResult {
    let best: ResolveResult | null = null;
    let bestPrice = listUnitPrice;
    let bestIsVariantScoped = false;

    for (const t of eligible) {
      const effective = computeEffectivePrice(t, listUnitPrice);
      const tierIsVariantScoped = t.variantId === variantId && variantId !== null;

      const isStrictlyBetter = effective < bestPrice;
      const isTiedWithVariantBoost = effective === bestPrice && tierIsVariantScoped && !bestIsVariantScoped;

      if (best === null || isStrictlyBetter || isTiedWithVariantBoost) {
        best = {
          effectiveUnitPrice: effective,
          appliedTierId: t.id,
          appliedDiscountPercent: t.discountPercent !== null ? Number(t.discountPercent) : null,
          appliedFixedUnitPrice: t.fixedUnitPrice !== null ? Number(t.fixedUnitPrice) : null,
          listUnitPrice,
        };
        bestPrice = effective;
        bestIsVariantScoped = tierIsVariantScoped;
      }
    }

    return best ?? baseResult(listUnitPrice);
  }
}

function isQtyInBand(t: Pick<TierRow, 'minQuantity' | 'maxQuantity'>, qty: number): boolean {
  if (qty < t.minQuantity) return false;
  if (t.maxQuantity !== null && qty > t.maxQuantity) return false;
  return true;
}

function computeEffectivePrice(
  t: Pick<TierRow, 'discountPercent' | 'fixedUnitPrice'>,
  listUnitPrice: number,
): number {
  if (t.fixedUnitPrice !== null) {
    return roundMoney(Number(t.fixedUnitPrice));
  }
  if (t.discountPercent !== null) {
    const pct = Number(t.discountPercent);
    return roundMoney(listUnitPrice * (1 - pct / 100));
  }
  // Defensive — the CHECK constraint forbids both null, but never
  // crash the cart over a bad row.
  return listUnitPrice;
}

function roundMoney(n: number): number {
  // Half-up at 2dp. Decimal-grade math would use Prisma.Decimal but
  // the cart already operates in JS numbers for line totals; the
  // rounding here matches the Math.round(x * 100) / 100 pattern used
  // elsewhere in the cart service.
  return Math.round(n * 100) / 100;
}

function baseResult(listUnitPrice: number): ResolveResult {
  return {
    effectiveUnitPrice: listUnitPrice,
    appliedTierId: null,
    appliedDiscountPercent: null,
    appliedFixedUnitPrice: null,
    listUnitPrice,
  };
}
