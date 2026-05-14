'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface PricingTier {
  id: string;
  productId: string;
  variantId: string | null;
  minQuantity: number;
  discountPercent: number;
  displayLabel: string;
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
   */
  currentQuantity?: number;
}

/**
 * Story 3.5 — Pricing tier upsell strip on the product detail page.
 *
 * v1 is display-only: this component reads `/storefront/products/:id/
 * pricing-tiers` and renders the ladder. Cart pricing is unchanged
 * at v1, so the copy is intentionally aspirational ("Save 10% if you
 * buy 5+") rather than committing to a discounted line total. Once
 * the cart-time application story ships, the same component can
 * highlight the *active* tier without further redesign.
 */
export function PricingTiersStrip({ productId, variantId, currentQuantity = 1 }: Props) {
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

  // The "active" tier is the highest minQuantity ≤ current.
  const activeTier =
    [...tiers].reverse().find((t) => t.minQuantity <= currentQuantity) ?? null;
  // The "next" tier is the lowest minQuantity > current — used for
  // the "add N more to unlock" hint.
  const nextTier = tiers.find((t) => t.minQuantity > currentQuantity) ?? null;

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
          <strong>{nextTier.discountPercent}% off</strong>.
        </p>
      )}
      {!nextTier && activeTier && (
        <p className="mt-2 text-body text-ink-900">
          You're at the top tier — eligible for <strong>{activeTier.discountPercent}% off</strong>.
        </p>
      )}

      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {tiers.map((tier) => {
          const isActive = activeTier?.id === tier.id;
          return (
            <li
              key={tier.id}
              className={`rounded-lg px-3 py-2 text-body flex items-center justify-between border ${
                isActive
                  ? 'border-success bg-success text-white font-semibold'
                  : 'border-ink-200 bg-white text-ink-900'
              }`}
            >
              <span>{tier.displayLabel}</span>
              {isActive && (
                <span className="text-caption uppercase tracking-wider">
                  Active
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-caption text-ink-600">
        Note: volume pricing is currently shown as a marketing preview. Cart prices
        will reflect tier savings in an upcoming release.
      </p>
    </section>
  );
}
