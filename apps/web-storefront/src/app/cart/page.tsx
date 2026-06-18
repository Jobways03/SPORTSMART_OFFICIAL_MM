'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Minus, Plus, Trash2, ShoppingBag, Lock, ArrowRight } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { apiClient } from '@/lib/api-client';
import { useAuthGuard } from '@/lib/useAuthGuard';

// Phase 258 — coupons are applied ONLY at checkout now (single source of
// truth). The cart no longer previews/handles coupons, so the sessionStorage
// handoff + PreviewedCoupon type were removed.

interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  productTitle: string;
  variantTitle: string | null;
  slug: string;
  imageUrl: string | null;
  unitPrice: number;
  lineTotal: number;
  stock: number;
  sellerShopName: string | null;
}

interface CartData {
  items: CartItem[];
  totalAmount: number;
  itemCount: number;
}

// Phase 36 — wire shape of /customer/tax-preview/cart. Mirrors the
// checkout-time CheckoutTaxPreview but inlined here so the cart page
// doesn't depend on the checkout module.
interface CartTaxPreview {
  subtotalTaxableInPaise: string;
  cgstInPaise: string;
  sgstInPaise: string;
  igstInPaise: string;
  cessInPaise: string;
  totalTaxInPaise: string;
  rawTotalInPaise: string;
  roundOffInPaise: string;
  grandTotalInPaise: string;
  hasIgst: boolean;
  hasCgstSgst: boolean;
  incompleteItemCount: number;
}

// Format a stringified paise value as ₹X,XX,XXX.YY using BigInt arithmetic
// so values past Number.MAX_SAFE_INTEGER still render exactly. Cart-side
// totals will never approach that range, but the helper stays consistent
// with the same one used at checkout.
function formatPaiseString(paise: string): string {
  let value: bigint;
  try {
    value = BigInt(paise);
  } catch {
    return '₹0.00';
  }
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  const negative = value < ZERO;
  const abs = negative ? -value : value;
  const rupees = abs / HUNDRED;
  const remainder = abs % HUNDRED;
  const rupeesStr = rupees
    .toString()
    .replace(/\B(?=(\d{2})+(\d{3})(?!\d))/g, ',');
  const paiseStr = remainder.toString().padStart(2, '0');
  return `${negative ? '-' : ''}₹${rupeesStr}.${paiseStr}`;
}

const formatINR = (n: number) => '₹' + Number(n).toLocaleString('en-IN');

export default function CartPage() {
  const router = useRouter();
  const authStatus = useAuthGuard();
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);


  // Phase 36 — cart-side tax preview. Uses the customer's default
  // address (if any) to derive CGST/SGST/IGST split before they enter
  // checkout. Best-effort: null = no default address yet, just falls
  // back to the legacy "Included in price" string.
  const [cartTax, setCartTax] = useState<CartTaxPreview | null>(null);


  const fetchCart = () => {
    apiClient<CartData>('/customer/cart')
      .then((res) => res.data && setCart(res.data))
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (authStatus !== 'authed') return;
    fetchCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Phase 4.12 (2026-05-16) — hammer-the-button guard.
  //
  // If the customer rapidly clicks +/- while a previous request is
  // in-flight, multiple PATCH calls can reorder over the network and
  // leave the cart in the wrong final quantity. We hold a click-block
  // for the duration of the request via the `updating` state (it's
  // already set per item; we just check it at the top of every action).
  const updateQuantity = async (itemId: string, quantity: number) => {
    if (updating === itemId) return; // hammer-block
    if (quantity < 1) return removeItem(itemId);
    setUpdating(itemId);
    try {
      await apiClient(`/customer/cart/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      });
      fetchCart();
      window.dispatchEvent(new Event('cart-updated'));
    } finally {
      setUpdating(null);
    }
  };

  const removeItem = async (itemId: string) => {
    if (updating === itemId) return; // hammer-block
    setUpdating(itemId);
    try {
      await apiClient(`/customer/cart/items/${itemId}`, { method: 'DELETE' });
      fetchCart();
      window.dispatchEvent(new Event('cart-updated'));
    } finally {
      setUpdating(null);
    }
  };

  // Phase 36 — fetch a server-computed tax preview using the customer's
  // default address. Re-runs whenever the cart subtotal or item count
  // changes (mirroring the coupon re-preview effect). Failures are
  // non-fatal: we just clear the tax breakdown and the summary degrades
  // to the legacy "GST: Included in price" string.
  useEffect(() => {
    if (!cart || cart.items.length === 0) {
      setCartTax(null);
      return;
    }
    let cancelled = false;
    // Phase 196 (#20) — debounce 400ms + abort the in-flight request. The
    // tax preview resolves HSN / GSTIN / place-of-supply (expensive); rapid
    // +/- clicks used to fan out one call per click. Now only the settled
    // cart state triggers a single request (matching the coupon effect's
    // AbortController pattern, which the tax effect previously lacked).
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => {
      apiClient<CartTaxPreview>('/customer/tax-preview/cart', {
        method: 'POST',
        body: JSON.stringify({}),
        signal: controller?.signal,
      })
        .then((res) => {
          if (cancelled) return;
          setCartTax(res.data ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          setCartTax(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart?.totalAmount, cart?.itemCount]);


  if (loading) {
    return (
      <StorefrontShell>
        <div className="container-x py-16">
          <div className="h-8 w-48 bg-ink-100 animate-pulse mb-6" />
          <div className="grid lg:grid-cols-[1fr_360px] gap-8">
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-32 bg-ink-100 animate-pulse" />
              ))}
            </div>
            <div className="h-72 bg-ink-100 animate-pulse" />
          </div>
        </div>
      </StorefrontShell>
    );
  }

  const totalItems = cart?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;
  const isEmpty = !cart || cart.items.length === 0;

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12">
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-3">
          <Link href="/" className="hover:text-ink-900">Home</Link>
          {' / '}
          <span>Cart</span>
        </div>

        <h1 className="font-display text-2xl sm:text-3xl text-ink-900 leading-tight">Your cart</h1>
        {!isEmpty && (
          <p className="mt-2 text-body text-ink-600">
            {totalItems} {totalItems === 1 ? 'item' : 'items'}
          </p>
        )}

        {isEmpty ? (
          <div className="mt-12 py-24 text-center border border-ink-200 rounded-2xl bg-white">
            <ShoppingBag className="size-12 mx-auto text-ink-400" strokeWidth={1.25} />
            <h3 className="mt-4 font-display text-h2 text-ink-900">Your cart is empty</h3>
            <p className="mt-3 text-body-lg text-ink-600 max-w-md mx-auto">
              Add a couple of items and they&apos;ll show up here.
            </p>
            <Link
              href="/products"
              className="mt-8 inline-flex items-center gap-2 h-12 px-6 bg-ink-900 text-white font-semibold hover:bg-ink-800 rounded-full"
            >
              Browse products
              <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : (
          <div className="mt-8 grid lg:grid-cols-[1fr_360px] gap-8">
            <div className="space-y-6">
              {/* Group items by seller so customers see clearly which
                  lines ship from which seller — important on a
                  multi-seller cart because each seller's items get their
                  own fulfillment + return window. Group totals + counts
                  are computed from the same flat `cart.items` list the
                  checkout uses, so the visual grouping never disagrees
                  with the order summary on the right. */}
              {(() => {
                const groups = new Map<string, typeof cart.items>();
                for (const item of cart!.items) {
                  // Phase 261 — the customer must NOT see which marketplace
                  // seller fulfils each item. Group everything under the
                  // SPORTSMART brand (one "Sold by SPORTSMART" card) instead of
                  // per-seller, matching the order page's "Fulfilled by SPORTSMART".
                  const key = 'SPORTSMART';
                  const existing = groups.get(key);
                  if (existing) existing.push(item);
                  else groups.set(key, [item]);
                }
                const entries = Array.from(groups.entries());
                return entries.map(([sellerName, items]) => {
                  // Phase 261 — no "Sold by" header at all (per product
                  // decision); the cart shows just the items in one card.
                  return (
                    <section
                      key={sellerName}
                      className="border border-ink-200 rounded-2xl overflow-hidden bg-white"
                    >
                      <ul className="divide-y divide-ink-200">
                        {items.map((item) => {
                          const isUpdating = updating === item.id;
                          return (
                            <li
                              key={item.id}
                              className={`grid grid-cols-[96px_1fr_auto] sm:grid-cols-[120px_1fr_auto] gap-4 sm:gap-6 px-4 sm:px-6 py-5 transition-opacity ${
                                isUpdating ? 'opacity-50' : ''
                              }`}
                            >
                              <Link
                                href={`/products/${item.slug}`}
                                className="aspect-square bg-ink-100 overflow-hidden"
                              >
                                {item.imageUrl ? (
                                  <img
                                    src={item.imageUrl}
                                    alt={item.productTitle}
                                    className="size-full object-contain"
                                  />
                                ) : (
                                  <div className="size-full grid place-items-center text-ink-400 font-display text-2xl">
                                    SM
                                  </div>
                                )}
                              </Link>

                              <div className="min-w-0">
                                <Link
                                  href={`/products/${item.slug}`}
                                  className="text-body-lg font-medium text-ink-900 hover:underline line-clamp-2"
                                >
                                  {item.productTitle}
                                </Link>
                                {item.variantTitle && (
                                  <div className="mt-1 text-caption text-ink-600">{item.variantTitle}</div>
                                )}
                                <div className="mt-2 text-body text-ink-700 tabular">
                                  {formatINR(item.unitPrice)} each
                                </div>

                                <div className="mt-3 flex items-center gap-3">
                                  <div className="inline-flex items-center border border-ink-300">
                                    <button
                                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                      disabled={isUpdating}
                                      className="size-8 grid place-items-center hover:bg-ink-100 disabled:opacity-50"
                                      aria-label="Decrease quantity"
                                    >
                                      <Minus className="size-3.5" />
                                    </button>
                                    <span className="w-8 text-center text-body font-medium tabular">
                                      {item.quantity}
                                    </span>
                                    <button
                                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                      disabled={isUpdating || item.quantity >= item.stock}
                                      className="size-8 grid place-items-center hover:bg-ink-100 disabled:opacity-50"
                                      aria-label="Increase quantity"
                                    >
                                      <Plus className="size-3.5" />
                                    </button>
                                  </div>
                                  <button
                                    onClick={() => removeItem(item.id)}
                                    disabled={isUpdating}
                                    className="inline-flex items-center gap-1.5 text-caption text-ink-600 hover:text-danger transition-colors"
                                  >
                                    <Trash2 className="size-3.5" /> Remove
                                  </button>
                                </div>
                              </div>

                              <div className="text-right text-body-lg font-semibold text-ink-900 tabular">
                                {formatINR(item.lineTotal)}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                });
              })()}
            </div>

            {/* Summary */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="border border-ink-200 p-6 bg-white rounded-2xl">
                <h3 className="font-display text-h3 text-ink-900 mb-4">Order summary</h3>
                <dl className="space-y-2.5 text-body">
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Subtotal · {totalItems} items</dt>
                    <dd className="text-ink-900 tabular font-medium">
                      {formatINR(cart!.totalAmount)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Delivery</dt>
                    <dd className="text-success font-medium uppercase tracking-wider text-caption">
                      Free
                    </dd>
                  </div>
                  {/* Phase 36 — when the backend returns a tax preview
                      (default address present), show the actual CGST/
                      SGST/IGST split. Otherwise fall back to the legacy
                      "Included in price" string. */}
                  {cartTax ? (
                    <>
                      {cartTax.hasCgstSgst && (
                        <>
                          <div className="flex justify-between">
                            <dt className="text-ink-600">CGST</dt>
                            <dd className="text-ink-900 tabular">
                              {formatPaiseString(cartTax.cgstInPaise)}
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-ink-600">SGST</dt>
                            <dd className="text-ink-900 tabular">
                              {formatPaiseString(cartTax.sgstInPaise)}
                            </dd>
                          </div>
                        </>
                      )}
                      {cartTax.hasIgst && (
                        <div className="flex justify-between">
                          <dt className="text-ink-600">IGST</dt>
                          <dd className="text-ink-900 tabular">
                            {formatPaiseString(cartTax.igstInPaise)}
                          </dd>
                        </div>
                      )}
                      {cartTax.cessInPaise !== '0' && (
                        <div className="flex justify-between">
                          <dt className="text-ink-600">Cess</dt>
                          <dd className="text-ink-900 tabular">
                            {formatPaiseString(cartTax.cessInPaise)}
                          </dd>
                        </div>
                      )}
                      {cartTax.incompleteItemCount > 0 && (
                        <div className="text-caption text-ink-500 mt-1">
                          Some items have incomplete tax data; final
                          invoice may differ slightly.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <dt className="text-ink-600">GST</dt>
                      <dd className="text-ink-600 text-caption">
                        Included in price
                      </dd>
                    </div>
                  )}
                </dl>

                {/* Phase 258 — coupons are applied at checkout only. The cart
                    no longer previews them; the customer sees the discount on
                    the checkout page. */}
                <hr className="my-4 border-ink-200" />
                <div className="flex justify-between items-baseline">
                  <span className="text-body-lg font-semibold text-ink-900">Total</span>
                  <span className="font-display text-3xl text-ink-900 tabular">
                    {formatINR(cart!.totalAmount)}
                  </span>
                </div>

                <button
                  onClick={() => router.push('/checkout')}
                  className="mt-6 w-full h-12 bg-ink-900 text-white font-semibold hover:bg-ink-800 inline-flex items-center justify-center gap-2 rounded-full"
                >
                  Proceed to checkout
                  <ArrowRight className="size-4" />
                </button>

                <Link
                  href="/products"
                  className="mt-3 w-full h-11 border border-ink-300 hover:border-ink-900 inline-flex items-center justify-center text-body font-medium text-ink-900 rounded-full"
                >
                  Continue shopping
                </Link>

                <div className="mt-5 flex items-center gap-2 text-caption text-ink-600">
                  <Lock className="size-3.5" /> Secure checkout · 256-bit SSL
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </StorefrontShell>
  );
}
