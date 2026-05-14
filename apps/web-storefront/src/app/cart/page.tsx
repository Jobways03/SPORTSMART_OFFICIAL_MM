'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Minus, Plus, Trash2, ShoppingBag, Lock, ArrowRight, Tag, X } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { apiClient } from '@/lib/api-client';
import { useAuthGuard } from '@/lib/useAuthGuard';

// Coupon preview is persisted to sessionStorage so checkout can
// auto-apply it without a second round-trip from the customer. Keep
// the key namespaced so other apps in the same origin don't collide.
const PREVIEW_COUPON_STORAGE_KEY = 'sm.previewedCoupon';

interface PreviewedCoupon {
  code: string;
  title: string | null;
  valueType: string;
  value: number;
  discountAmount: number;
}

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

const formatINR = (n: number) => '₹' + Number(n).toLocaleString('en-IN');

export default function CartPage() {
  const router = useRouter();
  const authStatus = useAuthGuard();
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  // Coupon preview state. The cart page is purely advisory — server
  // re-validates at placeOrder, so we just give the customer a hint of
  // savings here and hand the code off to checkout via sessionStorage.
  const [couponInput, setCouponInput] = useState('');
  const [couponApplying, setCouponApplying] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [previewedCoupon, setPreviewedCoupon] = useState<PreviewedCoupon | null>(null);

  // Hydrate any previously-previewed coupon (e.g. customer came back
  // from /products after applying a code on cart already). We re-fetch
  // it later only on subtotal change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem(PREVIEW_COUPON_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PreviewedCoupon;
      if (parsed?.code) {
        setPreviewedCoupon(parsed);
        setCouponInput(parsed.code);
      }
    } catch {
      // Corrupt storage value — silently drop it. Cart still works.
      window.sessionStorage.removeItem(PREVIEW_COUPON_STORAGE_KEY);
    }
  }, []);

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

  const updateQuantity = async (itemId: string, quantity: number) => {
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
    setUpdating(itemId);
    try {
      await apiClient(`/customer/cart/items/${itemId}`, { method: 'DELETE' });
      fetchCart();
      window.dispatchEvent(new Event('cart-updated'));
    } finally {
      setUpdating(null);
    }
  };

  // Apply a coupon code as a preview. Calls the same endpoint checkout
  // uses (`/customer/coupons/validate`) so the discountAmount the
  // customer sees here matches what they'll pay. The discount itself is
  // re-validated server-side at placeOrder — this is purely a preview.
  const applyCouponPreview = async () => {
    const code = couponInput.trim().toUpperCase();
    setCouponError('');
    if (!code) {
      setCouponError('Enter a coupon code');
      return;
    }
    if (!cart || cart.totalAmount <= 0) {
      setCouponError('Add items to your cart first');
      return;
    }
    setCouponApplying(true);
    try {
      const res = await apiClient<PreviewedCoupon>('/customer/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({
          code,
          subtotal: Number(cart.totalAmount),
          items: cart.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: Number(i.unitPrice),
          })),
        }),
      });
      const data = res.data;
      if (!data) {
        setCouponError(res.message || 'Invalid coupon');
        return;
      }
      setPreviewedCoupon(data);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(PREVIEW_COUPON_STORAGE_KEY, JSON.stringify(data));
      }
    } catch (err: any) {
      // The endpoint emits HTTP 429 for rate-limit and 400 for invalid
      // code; both surface here. Prefer the server's message so the
      // customer sees the specific rule that blocked their code.
      const status = err?.status ?? err?.response?.status;
      if (status === 429) {
        const retryAfter = err?.body?.retryAfterSeconds;
        setCouponError(
          retryAfter
            ? `Too many coupon attempts. Try again in ${retryAfter}s`
            : 'Too many coupon attempts. Please try again later.',
        );
      } else {
        setCouponError(err?.body?.message || err?.message || 'Invalid coupon');
      }
    } finally {
      setCouponApplying(false);
    }
  };

  const removeCouponPreview = () => {
    setPreviewedCoupon(null);
    setCouponInput('');
    setCouponError('');
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(PREVIEW_COUPON_STORAGE_KEY);
    }
  };

  // Re-validate the preview when the cart subtotal changes (qty change,
  // item add/remove). If the discount no longer applies (e.g. min-order
  // threshold), drop the preview silently so the summary stays accurate.
  useEffect(() => {
    if (!previewedCoupon || !cart || cart.totalAmount <= 0) return;
    let cancelled = false;
    apiClient<PreviewedCoupon>('/customer/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({
        code: previewedCoupon.code,
        subtotal: Number(cart.totalAmount),
        currentCouponCode: previewedCoupon.code,
        items: cart.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
        })),
      }),
    })
      .then((res) => {
        if (cancelled) return;
        const data = res.data;
        if (data) {
          setPreviewedCoupon(data);
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(PREVIEW_COUPON_STORAGE_KEY, JSON.stringify(data));
          }
        } else {
          removeCouponPreview();
        }
      })
      .catch(() => {
        if (cancelled) return;
        removeCouponPreview();
      });
    return () => {
      cancelled = true;
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

        <h1 className="font-display text-h1 sm:text-5xl text-ink-900 leading-none">Your cart</h1>
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
                  const key = item.sellerShopName ?? 'SPORTSMART';
                  const existing = groups.get(key);
                  if (existing) existing.push(item);
                  else groups.set(key, [item]);
                }
                const entries = Array.from(groups.entries());
                return entries.map(([sellerName, items]) => {
                  const groupSubtotal = items.reduce((s, i) => s + i.lineTotal, 0);
                  const groupQty = items.reduce((s, i) => s + i.quantity, 0);
                  return (
                    <section
                      key={sellerName}
                      className="border border-ink-200 rounded-2xl overflow-hidden bg-white"
                    >
                      <header className="flex items-center justify-between px-4 sm:px-6 py-3 bg-ink-50 border-b border-ink-200">
                        <div>
                          <div className="text-caption uppercase tracking-wider text-ink-600">
                            Sold by
                          </div>
                          <div className="text-body font-semibold text-ink-900">
                            {sellerName}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-caption text-ink-600">
                            {groupQty} {groupQty === 1 ? 'item' : 'items'}
                          </div>
                          <div className="text-body font-semibold text-ink-900 tabular">
                            {formatINR(groupSubtotal)}
                          </div>
                        </div>
                      </header>
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
                  {previewedCoupon && previewedCoupon.discountAmount > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-success">
                        Coupon · {previewedCoupon.code}
                      </dt>
                      <dd className="text-success tabular font-medium">
                        − {formatINR(previewedCoupon.discountAmount)}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Delivery</dt>
                    <dd className="text-success font-medium uppercase tracking-wider text-caption">
                      Free
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Estimated tax</dt>
                    <dd className="text-ink-600 text-caption">Calculated at checkout</dd>
                  </div>
                </dl>

                {/* Coupon preview block — purely advisory. Server
                    re-validates at placeOrder so a stale preview can't
                    grant a discount the rules don't allow. */}
                <div className="mt-4 pt-4 border-t border-ink-200">
                  {previewedCoupon ? (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-success/5 border border-success/30">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-caption uppercase tracking-wider text-success font-semibold">
                          <Tag className="size-3.5" /> Applied
                        </div>
                        <div className="mt-0.5 text-body font-medium text-ink-900 tabular">
                          {previewedCoupon.code}
                        </div>
                        {previewedCoupon.title && (
                          <div className="text-caption text-ink-600 line-clamp-1">
                            {previewedCoupon.title}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={removeCouponPreview}
                        className="shrink-0 inline-flex items-center gap-1 text-caption text-ink-600 hover:text-danger"
                        aria-label="Remove coupon"
                      >
                        <X className="size-3.5" /> Remove
                      </button>
                    </div>
                  ) : (
                    <div>
                      <label
                        htmlFor="cart-coupon-input"
                        className="text-caption uppercase tracking-wider text-ink-600"
                      >
                        Have a coupon?
                      </label>
                      <div className="mt-1.5 flex gap-2">
                        <input
                          id="cart-coupon-input"
                          type="text"
                          autoComplete="off"
                          spellCheck={false}
                          value={couponInput}
                          onChange={(e) => {
                            setCouponInput(e.target.value.toUpperCase());
                            if (couponError) setCouponError('');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !couponApplying) {
                              e.preventDefault();
                              applyCouponPreview();
                            }
                          }}
                          placeholder="ENTER CODE"
                          aria-invalid={!!couponError}
                          className={`flex-1 h-10 px-3 border bg-white text-body font-medium tabular focus:outline-none focus:border-ink-900 rounded-md ${
                            couponError ? 'border-danger' : 'border-ink-300'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={applyCouponPreview}
                          disabled={couponApplying || !couponInput.trim()}
                          className="h-10 px-4 bg-ink-900 text-white font-semibold text-caption uppercase tracking-wider rounded-md hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {couponApplying ? 'Applying…' : 'Apply'}
                        </button>
                      </div>
                      {couponError && (
                        <p className="mt-1.5 text-caption text-danger">{couponError}</p>
                      )}
                    </div>
                  )}
                </div>

                <hr className="my-4 border-ink-200" />
                <div className="flex justify-between items-baseline">
                  <span className="text-body-lg font-semibold text-ink-900">Total</span>
                  <span className="font-display text-3xl text-ink-900 tabular">
                    {formatINR(
                      Math.max(
                        0,
                        cart!.totalAmount - (previewedCoupon?.discountAmount ?? 0),
                      ),
                    )}
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
