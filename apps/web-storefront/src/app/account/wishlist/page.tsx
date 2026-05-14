'use client';

// Sprint 2 Story 2.2 (frontend) — wishlist page, backed by the
// /customer/wishlist endpoint shipped in the backend Story 2.2.
//
// MVP scope:
//   - Auth-gated via useAuthGuard hook (consistent with other /account/*).
//   - List wishlist items with product title + price + remove button.
//   - Empty state with a CTA back to /products.
//   - Optimistic remove (refresh on action — no fancy state mgmt yet).
//
// Out of MVP scope (follow-up frontend stories):
//   - Move-to-cart action (needs cart-service add wiring).
//   - Variant picker when item has multiple variants.
//   - Notes editor.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { wishlistService, WishlistItem } from '@/services/wishlist.service';
import { StorefrontShell } from '@/components/layout/StorefrontShell';

export default function WishlistPage() {
  const authStatus = useAuthGuard('/login?redirect=/account/wishlist');
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await wishlistService.list(1, 100);
      setItems(res.data?.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wishlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authStatus === 'authed') void load();
  }, [authStatus, load]);

  const handleRemove = async (itemId: string) => {
    setRemovingId(itemId);
    try {
      await wishlistService.remove(itemId);
      // Optimistic — drop locally; re-fetch on next mount to reconcile.
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove item');
    } finally {
      setRemovingId(null);
    }
  };

  if (authStatus !== 'authed') {
    return (
      <StorefrontShell>
        <div className="container mx-auto px-4 py-10 text-center text-ink-500">
          Checking your session…
        </div>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <div className="container mx-auto px-4 py-10">
        <header className="mb-8">
          <h1 className="text-h2 font-display text-ink-900">My Wishlist</h1>
          <p className="text-body text-ink-600">
            Items you&apos;ve saved for later. Wishlist items don&apos;t reserve
            stock — add to cart when you&apos;re ready.
          </p>
        </header>

        {error && (
          <div className="mb-6 rounded-md border border-sale/30 bg-sale-soft px-4 py-3 text-body-sm text-sale-dark">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-ink-500 py-12">Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-ink-200 bg-ink-50 px-6 py-16 text-center">
            <p className="text-body text-ink-700 mb-4">
              Your wishlist is empty.
            </p>
            <Link
              href="/products"
              className="inline-block rounded-md bg-accent px-5 py-2 text-white hover:bg-accent-dark"
            >
              Browse products
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const price = item.variant?.price ?? item.product.basePrice;
              const displayPrice =
                price != null ? `₹${Number(price).toLocaleString('en-IN')}` : null;
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-md border border-ink-200 bg-white px-5 py-4"
                >
                  <div className="flex-1">
                    <Link
                      href={`/products/${item.product.slug}`}
                      className="text-body font-medium text-ink-900 hover:text-accent"
                    >
                      {item.product.title}
                    </Link>
                    {item.variant?.sku && (
                      <div className="text-caption text-ink-500 mt-1">
                        SKU: {item.variant.sku}
                      </div>
                    )}
                    {item.note && (
                      <div className="text-caption text-ink-600 italic mt-1">
                        “{item.note}”
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    {displayPrice && (
                      <span className="text-body-sm font-medium text-ink-900">
                        {displayPrice}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemove(item.id)}
                      disabled={removingId === item.id}
                      className="text-caption text-sale hover:text-sale-dark disabled:opacity-50"
                    >
                      {removingId === item.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </StorefrontShell>
  );
}
