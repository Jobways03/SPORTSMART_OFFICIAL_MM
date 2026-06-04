'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ShoppingBag, X, Minus, Plus, Trash2, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

/**
 * Phase 196 (#2) — the storefront previously had NO cart drawer; add-to-cart
 * only flashed a 2.2s text label and the cart icon was a plain Link to
 * /cart. This is the slide-out drawer the "Cart Drawer Flow" assumes:
 *
 *   - Opens on the `cart-open` window event (dispatched by the PDP
 *     add-to-cart success and by the Navbar cart button).
 *   - Refetches on `cart-updated` so the count badge and the drawer stay
 *     in sync with quantity edits / removals made anywhere.
 *   - aria-modal dialog: Escape + backdrop close, focus moves into the
 *     panel on open and is restored on close, body scroll is locked.
 *   - Inline quantity stepper (PATCH) + remove (DELETE) hitting the same
 *     /customer/cart endpoints as the full cart page.
 *   - Subtotal rendered from the exact paise string (#14) when present.
 */

interface DrawerItem {
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
  outOfStock?: boolean;
  unavailable?: boolean;
  priceChanged?: boolean;
  sellerShopName: string | null;
}

interface DrawerCart {
  items: DrawerItem[];
  totalAmount: number;
  totalAmountInPaise?: string;
  itemCount: number;
}

function formatPaise(paise: string): string {
  let value: bigint;
  try {
    value = BigInt(paise);
  } catch {
    return '₹0.00';
  }
  const HUNDRED = BigInt(100);
  const neg = value < BigInt(0);
  const abs = neg ? -value : value;
  const rupees = (abs / HUNDRED).toString().replace(/\B(?=(\d{2})+(\d{3})(?!\d))/g, ',');
  const paiseStr = (abs % HUNDRED).toString().padStart(2, '0');
  return `${neg ? '-' : ''}₹${rupees}.${paiseStr}`;
}

const formatINR = (n: number) => '₹' + Number(n).toLocaleString('en-IN');

export function CartDrawer() {
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState<DrawerCart | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const fetchCart = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<DrawerCart>('/customer/cart');
      setCart(res.data ?? null);
    } catch {
      setCart(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Open on `cart-open`; keep in sync on `cart-updated`.
  useEffect(() => {
    const onOpen = () => {
      lastFocusedRef.current = document.activeElement as HTMLElement;
      setOpen(true);
      fetchCart();
    };
    window.addEventListener('cart-open', onOpen);
    return () => window.removeEventListener('cart-open', onOpen);
  }, [fetchCart]);

  useEffect(() => {
    const onUpdate = () => {
      if (open) fetchCart();
    };
    window.addEventListener('cart-updated', onUpdate);
    return () => window.removeEventListener('cart-updated', onUpdate);
  }, [open, fetchCart]);

  const close = useCallback(() => {
    setOpen(false);
    // restore focus to whatever opened the drawer
    lastFocusedRef.current?.focus?.();
  }, []);

  // Escape to close + body scroll lock + initial focus while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open, close]);

  const setQty = async (item: DrawerItem, next: number) => {
    if (busyItem) return;
    if (next < 1) return remove(item);
    if (item.stock > 0 && next > item.stock) return;
    setBusyItem(item.id);
    try {
      await apiClient(`/customer/cart/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity: next }),
      });
      await fetchCart();
      window.dispatchEvent(new Event('cart-updated'));
    } catch {
      /* surfaced by the refetch */
    } finally {
      setBusyItem(null);
    }
  };

  const remove = async (item: DrawerItem) => {
    if (busyItem) return;
    setBusyItem(item.id);
    try {
      await apiClient(`/customer/cart/items/${item.id}`, { method: 'DELETE' });
      await fetchCart();
      window.dispatchEvent(new Event('cart-updated'));
    } catch {
      /* ignore */
    } finally {
      setBusyItem(null);
    }
  };

  if (!open) return null;

  const items = cart?.items ?? [];
  const subtotal =
    cart?.totalAmountInPaise != null
      ? formatPaise(cart.totalAmountInPaise)
      : formatINR(cart?.totalAmount ?? 0);

  return (
    <div className="fixed inset-0 z-[100]" aria-hidden={false}>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close cart"
        onClick={close}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-[1px] animate-[fadeIn_120ms_ease-out]"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        tabIndex={-1}
        className="absolute right-0 top-0 h-full w-full max-w-[420px] bg-white shadow-2xl flex flex-col outline-none animate-[slideInRight_180ms_ease-out]"
      >
        <header className="flex items-center justify-between px-5 h-14 border-b border-ink-200">
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-5" strokeWidth={1.75} />
            <h2 className="text-body font-semibold text-ink-900">
              Your cart{cart ? ` (${cart.itemCount})` : ''}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close cart"
            className="size-9 grid place-items-center text-ink-500 hover:text-ink-900 hover:bg-ink-100 rounded-full transition-colors"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loading && !cart ? (
            <div className="h-full grid place-items-center text-ink-500">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="h-full grid place-items-center text-center px-6">
              <div>
                <ShoppingBag className="size-10 mx-auto text-ink-300" strokeWidth={1.25} />
                <p className="mt-3 text-body text-ink-700">Your cart is empty</p>
                <Link
                  href="/products"
                  onClick={close}
                  className="mt-4 inline-block text-caption font-semibold text-accent-dark hover:underline underline-offset-2"
                >
                  Continue shopping
                </Link>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {items.map((item) => (
                <li key={item.id} className="flex gap-3 p-4">
                  <Link
                    href={`/products/${item.slug}`}
                    onClick={close}
                    className="shrink-0 size-16 bg-ink-50 rounded-lg overflow-hidden grid place-items-center"
                  >
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imageUrl} alt={item.productTitle} className="size-full object-cover" />
                    ) : (
                      <ShoppingBag className="size-6 text-ink-300" />
                    )}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/products/${item.slug}`}
                      onClick={close}
                      className="text-[13.5px] font-medium text-ink-900 line-clamp-2 hover:underline underline-offset-2"
                    >
                      {item.productTitle}
                    </Link>
                    {item.variantTitle && (
                      <p className="text-[11px] text-ink-500 mt-0.5">{item.variantTitle}</p>
                    )}
                    {item.unavailable ? (
                      <p className="text-[11px] text-sale font-medium mt-1">No longer available</p>
                    ) : item.priceChanged ? (
                      <p className="text-[11px] text-accent-dark mt-1">Price updated since you added</p>
                    ) : null}
                    <div className="flex items-center justify-between mt-2">
                      <div className="inline-flex items-center border border-ink-200 rounded-full">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          disabled={busyItem === item.id}
                          onClick={() => setQty(item, item.quantity - 1)}
                          className="size-7 grid place-items-center text-ink-600 hover:text-ink-900 disabled:opacity-40"
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="min-w-7 text-center text-caption tabular">
                          {busyItem === item.id ? (
                            <Loader2 className="size-3.5 animate-spin inline" />
                          ) : (
                            item.quantity
                          )}
                        </span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          disabled={busyItem === item.id || (item.stock > 0 && item.quantity >= item.stock)}
                          onClick={() => setQty(item, item.quantity + 1)}
                          className="size-7 grid place-items-center text-ink-600 hover:text-ink-900 disabled:opacity-40"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      <span className="text-caption font-semibold text-ink-900 tabular">
                        {formatINR(item.lineTotal)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${item.productTitle}`}
                    disabled={busyItem === item.id}
                    onClick={() => remove(item)}
                    className="shrink-0 size-8 grid place-items-center text-ink-400 hover:text-sale disabled:opacity-40"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <footer className="border-t border-ink-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-caption text-ink-600">Subtotal</span>
              <span className="text-body font-semibold text-ink-900 tabular">{subtotal}</span>
            </div>
            <p className="text-[11px] text-ink-500">Taxes &amp; shipping calculated at checkout.</p>
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/cart"
                onClick={close}
                className="h-11 grid place-items-center border border-ink-300 text-caption font-semibold text-ink-900 hover:border-ink-900 rounded-full transition-colors"
              >
                View cart
              </Link>
              <Link
                href="/checkout"
                onClick={close}
                className="h-11 grid place-items-center bg-ink-900 text-white text-caption font-semibold hover:bg-ink-800 rounded-full transition-colors"
              >
                Checkout
              </Link>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
