'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Minus, Plus, Trash2, ShoppingBag, Lock, ArrowRight } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { apiClient } from '@/lib/api-client';

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
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchCart = () => {
    apiClient<CartData>('/customer/cart')
      .then((res) => res.data && setCart(res.data))
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    try {
      const token = sessionStorage.getItem('accessToken');
      if (!token) return router.push('/login');
    } catch {
      return router.push('/login');
    }
    fetchCart();
  }, []);

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
            <ul className="border-y border-ink-200 divide-y divide-ink-200">
              {cart!.items.map((item) => {
                const isUpdating = updating === item.id;
                return (
                  <li
                    key={item.id}
                    className={`grid grid-cols-[96px_1fr_auto] sm:grid-cols-[120px_1fr_auto] gap-4 sm:gap-6 py-5 transition-opacity ${
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
                      {item.sellerShopName && (
                        <div className="text-caption text-ink-500">Sold by {item.sellerShopName}</div>
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
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Estimated tax</dt>
                    <dd className="text-ink-600 text-caption">Calculated at checkout</dd>
                  </div>
                </dl>
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
