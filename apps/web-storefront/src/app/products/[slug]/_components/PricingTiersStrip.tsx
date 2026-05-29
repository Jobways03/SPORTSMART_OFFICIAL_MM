'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface PricingTier {
  id: string;
  productId: string;
  variantId: string | null;
  minQuantity: number;
  // Phase 44 (2026-05-21) — extended shape. Either discountPercent or
  // fixedUnitPrice is non-null on every row.
  maxQuantity: number | null;
  discountPercent: number | null;
  fixedUnitPrice: number | null;
  displayLabel: string;
  startAt: string | null;
  endAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  productId: string;
  variantId?: string | null;
  /**
   * Current line quantity the customer has in mind. Used to highlight
   * the active tier + show the "add N more to unlock" hint for the
   * next rung. Defaults to 1 so the strip is sensible even before
   * the customer picks a quantity.
   *
   * Phase 44 (2026-05-21) — when this prop changes, the strip
   * re-evaluates the active rung; the parent PDP wires this to the
   * qty selector via state so the strip dynamically tracks the
   * customer's selection.
   */
  currentQuantity?: number;
  /**
   * Phase 44 (2026-05-21) — base unit price from the PDP. Optional;
   * when provided we render the absolute effective price next to
   * each tier ("₹X per unit").
   */
  listUnitPrice?: number;
}

/**
 * Story 3.5 / Phase 44 (2026-05-21) — Pricing tier strip on the
 * product detail page.
 *
 * v1 was display-only. v2 (Phase 44) wires tier pricing into the
 * cart + checkout + order placement flow, so the strip can confidently
 * tell the customer what they'll pay. The component highlights the
 * active rung, surfaces the next rung's threshold, and (when
 * listUnitPrice is supplied) shows the effective per-unit price for
 * each tier.
 */
export function PricingTiersStrip({
  productId,
  variantId,
  currentQuantity = 1,
  listUnitPrice,
}: Props) {
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setLoading(true);
    const qs = variantId ? `?variantId=${encodeURIComponent(variantId)}` : '';
    apiClient<PricingTier[]>(`/storefront/products/${productId}/pricing-tiers${qs}`)
      .then((res) => {
        if (cancelled) return;
        setTiers(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        // 404 on a product without tiers, or transient — silently
        // render nothing rather than blocking the PDP.
        if (cancelled) return;
        setTiers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, variantId]);

  if (loading) return null;
  if (tiers.length === 0) return null;

  // Phase 44 (2026-05-21) — pick the best-effective tier for the
  // current quantity. Mirrors the backend resolver so the customer
  // sees the same tier the cart will apply. Tier is eligible when
  // qty is in [minQty, maxQty] and (if either bound is set) the
  // current time falls in the schedule window.
  const now = Date.now();
  const isEligible = (t: PricingTier) => {
    if (!t.isActive) return false;
    if (currentQuantity < t.minQuantity) return false;
    if (t.maxQuantity !== null && currentQuantity > t.maxQuantity) return false;
    if (t.startAt && new Date(t.startAt).getTime() > now) return false;
    if (t.endAt && new Date(t.endAt).getTime() <= now) return false;
    return true;
  };
  const computeEffective = (t: PricingTier, list: number): number => {
    if (t.fixedUnitPrice !== null) return t.fixedUnitPrice;
    if (t.discountPercent !== null) return Math.round(list * (1 - t.discountPercent / 100) * 100) / 100;
    return list;
  };

  const eligible = tiers.filter(isEligible);
  // Best-effective tier wins (matches backend best-discount-wins).
  const activeTier = eligible.length > 0 && listUnitPrice
    ? eligible.reduce((best, t) =>
        computeEffective(t, listUnitPrice) < computeEffective(best, listUnitPrice) ? t : best,
      )
    : eligible[0] ?? null;

  // The "next" tier is the lowest minQuantity > current — used for
  // the "add N more to unlock" hint.
  const nextTier = tiers.find((t) => t.isActive && t.minQuantity > currentQuantity) ?? null;

  return (
    <section
      aria-labelledby="pricing-tiers-heading"
      className="mt-6 rounded-2xl border border-success/30 bg-success/5 p-5"
    >
      <h3
        id="pricing-tiers-heading"
        className="text-caption uppercase tracking-wider text-success font-semibold flex items-center gap-2"
      >
        <span aria-hidden>🏷️</span> Volume savings
      </h3>

      {nextTier && (
        <p className="mt-2 text-body text-ink-900">
          Add{' '}
          <strong>{nextTier.minQuantity - currentQuantity}</strong> more to unlock{' '}
          <strong>
            {nextTier.discountPercent !== null
              ? `${nextTier.discountPercent}% off`
              : nextTier.fixedUnitPrice !== null
                ? `₹${nextTier.fixedUnitPrice} per unit`
                : 'a discount'}
          </strong>
          .
        </p>
      )}
      {!nextTier && activeTier && (
        <p className="mt-2 text-body text-ink-900">
          You're at the top tier — eligible for{' '}
          <strong>
            {activeTier.discountPercent !== null
              ? `${activeTier.discountPercent}% off`
              : `₹${activeTier.fixedUnitPrice} per unit`}
          </strong>
          .
        </p>
      )}

      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {tiers.map((tier) => {
          const isActive = activeTier?.id === tier.id;
          const effectivePrice =
            listUnitPrice !== undefined ? computeEffective(tier, listUnitPrice) : null;
          return (
            <li
              key={tier.id}
              className={`rounded-lg px-3 py-2 text-body flex items-center justify-between border ${
                isActive
                  ? 'border-success bg-success text-white font-semibold'
                  : 'border-ink-200 bg-white text-ink-900'
              }`}
            >
              <span>
                {tier.displayLabel}
                {effectivePrice !== null && (
                  <span className="ml-2 text-caption">
                    (₹{effectivePrice.toFixed(2)}/unit)
                  </span>
                )}
              </span>
              {isActive && (
                <span className="text-caption uppercase tracking-wider">
                  Active
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
