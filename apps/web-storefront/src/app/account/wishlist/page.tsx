'use client';

// Sprint 2 Story 2.2 (frontend) — wishlist page, backed by the
// /customer/wishlist endpoint.
//
// Phase 202 hardening:
//   - #3/#12: the API now returns a computed `available` boolean and
//     suppresses the price for unavailable rows; the page renders an
//     "no longer available" state instead of a stale price.
//   - #7: move-to-cart action (adds to cart via the cart endpoint, then
//     removes the wishlist row through the validated backend endpoint).
//   - #13: shows a "price dropped" hint when the live price is below the
//     add-time snapshot.
//   - #14: money is a string in paise; coerced with Number() only at the
//     format boundary.
//   - #15: store sync so the Navbar badge updates on remove/move.
//   - #16: product image + brand in the row.
//   - #18: pagination (replaces the old hard 100-item cap).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ShoppingBag, Trash2, ArrowDownRight } from 'lucide-react';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { wishlistService, WishlistItem } from '@/services/wishlist.service';
import { apiClient } from '@/lib/api-client';
import { wishlistStore } from '@/components/ui/ProductCard';
import { StorefrontShell } from '@/components/layout/StorefrontShell';

const PAGE_SIZE = 24;

const formatINRFromPaise = (paise: string) =>
  '₹' + (Number(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function WishlistPage() {
  const authStatus = useAuthGuard('/login?redirect=/account/wishlist');
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (targetPage: number) => {
    setLoading(true);
    try {
      const res = await wishlistService.list(targetPage, PAGE_SIZE);
      setItems(res.data?.items ?? []);
      setTotal(res.data?.total ?? 0);
      setPage(targetPage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wishlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authStatus === 'authed') void load(1);
  }, [authStatus, load]);

  const handleRemove = async (item: WishlistItem) => {
    setBusyId(item.id);
    try {
      await wishlistService.remove(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setTotal((t) => Math.max(0, t - 1));
      // #15 — keep the shared store (and Navbar badge) in sync.
      wishlistStore.markRemoved(item.productId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove item');
    } finally {
      setBusyId(null);
    }
  };

  // #7 — move-to-cart. Add to cart via the cart endpoint first (which
  // re-validates stock/variant/active), then call the validated wishlist
  // move endpoint to drop the row. Done in this order so a cart failure
  // leaves the wishlist row intact.
  const handleMoveToCart = async (item: WishlistItem) => {
    setBusyId(item.id);
    try {
      await apiClient('/customer/cart/items', {
        method: 'POST',
        body: JSON.stringify({
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          quantity: 1,
        }),
      });
      await wishlistService.moveToCart(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setTotal((t) => Math.max(0, t - 1));
      wishlistStore.markRemoved(item.productId);
      window.dispatchEvent(new Event('cart-updated'));
      window.dispatchEvent(new Event('cart-open'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move item to cart');
    } finally {
      setBusyId(null);
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <StorefrontShell>
      <div className="container mx-auto px-4 py-10">
        <header className="mb-8">
          <h1 className="text-h2 font-display text-ink-900">My Wishlist</h1>
          <p className="text-body text-ink-600">
            Items you&apos;ve saved for later. Wishlist items don&apos;t reserve
            stock — move to cart when you&apos;re ready.
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
          <>
            <ul className="space-y-3">
              {items.map((item) => {
                // #13 — price-drop hint: live price below the add-time snapshot.
                const priceDropped =
                  item.available &&
                  item.priceInPaise != null &&
                  item.unitPriceInPaiseAtAdd != null &&
                  Number(item.priceInPaise) < Number(item.unitPriceInPaiseAtAdd);

                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-4 rounded-md border border-ink-200 bg-white px-5 py-4"
                  >
                    {/* #16 — product thumbnail */}
                    <Link
                      href={`/products/${item.product.slug}`}
                      className="shrink-0 size-16 rounded-md overflow-hidden bg-ink-100 grid place-items-center"
                    >
                      {item.product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.product.imageUrl}
                          alt={item.product.imageAlt || item.product.title}
                          className="size-full object-contain"
                        />
                      ) : (
                        <span className="font-display text-ink-400 text-xl">SM</span>
                      )}
                    </Link>

                    <div className="flex-1 min-w-0">
                      {/* #16 — brand */}
                      {item.product.brand && (
                        <div className="text-caption uppercase tracking-wider text-ink-500 font-semibold truncate">
                          {item.product.brand.name}
                        </div>
                      )}
                      <Link
                        href={`/products/${item.product.slug}`}
                        className="text-body font-medium text-ink-900 hover:text-accent truncate block"
                      >
                        {item.product.title}
                      </Link>
                      {item.variant?.sku && (
                        <div className="text-caption text-ink-500 mt-0.5">
                          SKU: {item.variant.sku}
                        </div>
                      )}
                      {item.note && (
                        <div className="text-caption text-ink-600 italic mt-0.5 truncate">
                          “{item.note}”
                        </div>
                      )}
                      {/* #3/#12 — unavailable state */}
                      {!item.available && (
                        <div className="mt-1 text-caption font-semibold text-ink-500">
                          No longer available
                        </div>
                      )}
                      {priceDropped && (
                        <div className="mt-1 inline-flex items-center gap-1 text-caption font-semibold text-success">
                          <ArrowDownRight className="size-3" />
                          Price dropped since you saved this
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {/* #14 — money from paise string at the format edge */}
                      {item.available && item.priceInPaise != null && (
                        <span className="text-body font-semibold text-ink-900">
                          {formatINRFromPaise(item.priceInPaise)}
                        </span>
                      )}
                      <div className="flex items-center gap-2">
                        {/* #7 — move to cart */}
                        {item.available && (
                          <button
                            type="button"
                            onClick={() => void handleMoveToCart(item)}
                            disabled={busyId === item.id}
                            className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3 py-1.5 text-caption font-semibold text-white hover:bg-ink-800 disabled:opacity-50"
                          >
                            <ShoppingBag className="size-3.5" />
                            {busyId === item.id ? 'Moving…' : 'Move to cart'}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Remove from wishlist"
                          onClick={() => void handleRemove(item)}
                          disabled={busyId === item.id}
                          className="inline-flex items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1.5 text-caption text-sale hover:bg-sale-soft disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* #18 — pagination (replaces the old hard 100 cap) */}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void load(page - 1)}
                  disabled={page <= 1 || loading}
                  className="rounded-md border border-ink-300 px-4 py-2 text-body-sm text-ink-900 hover:border-ink-900 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-body-sm text-ink-600 tabular">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => void load(page + 1)}
                  disabled={page >= totalPages || loading}
                  className="rounded-md border border-ink-300 px-4 py-2 text-body-sm text-ink-900 hover:border-ink-900 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </StorefrontShell>
  );
}
