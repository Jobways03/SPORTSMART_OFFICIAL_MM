'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
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

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchCart = () => {
    apiClient<CartData>('/customer/cart')
      .then((res) => {
        if (res.data) setCart(res.data);
      })
      .catch(() => {
        router.push('/login');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    try {
      const token = sessionStorage.getItem('accessToken');
      if (!token) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }
    fetchCart();
  }, []);

  const updateQuantity = async (itemId: string, quantity: number) => {
    setUpdating(itemId);
    try {
      await apiClient(`/customer/cart/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      });
      fetchCart();
      window.dispatchEvent(new Event('cart-updated'));
    } catch {
      // ignore
    } finally {
      setUpdating(null);
    }
  };

  const removeItem = async (itemId: string) => {
    setUpdating(itemId);
    try {
      await apiClient(`/customer/cart/items/${itemId}`, {
        method: 'DELETE',
      });
      fetchCart();
      window.dispatchEvent(new Event('cart-updated'));
    } catch {
      // ignore
    } finally {
      setUpdating(null);
    }
  };

  const formatPrice = (price: number) => `\u20B9${Number(price).toLocaleString('en-IN')}`;

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">Loading cart...</div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 60px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Shopping Cart</h1>

        {!cart || cart.items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#128722;</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Your cart is empty</h3>
            <p style={{ color: '#6b7280', marginBottom: 20 }}>Add some products to get started</p>
            <Link
              href="/"
              style={{
                display: 'inline-block',
                padding: '10px 24px',
                background: '#111',
                color: '#fff',
                borderRadius: 8,
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Continue Shopping
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* Cart Items */}
            <div style={{ flex: '1 1 500px' }}>
              {cart.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    gap: 16,
                    padding: 16,
                    borderBottom: '1px solid #f3f4f6',
                    opacity: updating === item.id ? 0.5 : 1,
                  }}
                >
                  <div style={{
                    width: 80,
                    height: 80,
                    borderRadius: 8,
                    background: '#f9fafb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.productTitle} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 32, color: '#d1d5db' }}>&#128722;</span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <Link
                      href={`/products/${item.slug}`}
                      style={{ fontWeight: 600, fontSize: 15, color: '#111', textDecoration: 'none' }}
                    >
                      {item.productTitle}
                    </Link>
                    {item.variantTitle && (
                      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{item.variantTitle}</div>
                    )}
                    {item.sellerShopName && (
                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>by {item.sellerShopName}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          disabled={updating === item.id}
                          style={{ width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}
                        >
                          -
                        </button>
                        <span style={{ width: 32, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={updating === item.id || item.quantity >= item.stock}
                          style={{ width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}
                        >
                          +
                        </button>
                      </div>
                      <button
                        onClick={() => removeItem(item.id)}
                        disabled={updating === item.id}
                        style={{ border: 'none', background: 'none', color: '#dc2626', fontSize: 13, cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap' }}>
                    {formatPrice(item.lineTotal)}
                  </div>
                </div>
              ))}
            </div>

            {/* Order Summary */}
            <div style={{
              flex: '0 0 280px',
              background: '#f9fafb',
              borderRadius: 12,
              padding: 20,
              height: 'fit-content',
              position: 'sticky',
              top: 80,
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Order Summary</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
                <span>Items ({cart.itemCount})</span>
                <span>{formatPrice(cart.totalAmount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
                <span>Delivery</span>
                <span style={{ color: '#16a34a' }}>FREE</span>
              </div>
              <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                <span>Total</span>
                <span>{formatPrice(cart.totalAmount)}</span>
              </div>
              <button
                onClick={() => router.push('/checkout')}
                style={{
                  width: '100%',
                  marginTop: 16,
                  padding: '12px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: 'none',
                  background: '#111',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Proceed to Checkout
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
