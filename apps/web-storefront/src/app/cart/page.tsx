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
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading cart...</span>
        </div>
      </>
    );
  }

  const totalItems = cart?.items.reduce((sum, i) => sum + i.quantity, 0) || 0;

  return (
    <>
      <Navbar />
      <div className="cart-page">
        <h1>Shopping Cart</h1>
        <p className="cart-subtitle">
          {cart && cart.items.length > 0
            ? `${totalItems} item${totalItems !== 1 ? 's' : ''} in your cart`
            : ''}
        </p>

        {!cart || cart.items.length === 0 ? (
          <div className="cart-empty">
            <span className="cart-empty-icon">&#128722;</span>
            <h3>Your cart is empty</h3>
            <p>Looks like you haven&#39;t added anything yet. Start shopping!</p>
            <Link href="/" className="cart-empty-btn">
              Continue Shopping
            </Link>
          </div>
        ) : (
          <div className="cart-layout">
            {/* Cart Items */}
            <div className="cart-items">
              {cart.items.map((item) => (
                <div
                  key={item.id}
                  className={`cart-item${updating === item.id ? ' updating' : ''}`}
                >
                  <div className="cart-item-image">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.productTitle} />
                    ) : (
                      <span className="placeholder">&#128722;</span>
                    )}
                  </div>
                  <div className="cart-item-details">
                    <Link href={`/products/${item.slug}`} className="cart-item-title">
                      {item.productTitle}
                    </Link>
                    {item.variantTitle && (
                      <div className="cart-item-variant">{item.variantTitle}</div>
                    )}
                    {item.sellerShopName && (
                      <div className="cart-item-seller">Sold by {item.sellerShopName}</div>
                    )}
                    <div className="cart-item-unit-price">
                      {formatPrice(item.unitPrice)} each
                    </div>
                    <div className="cart-item-actions">
                      <div className="cart-qty-control">
                        <button
                          className="cart-qty-btn"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          disabled={updating === item.id}
                        >
                          &#8722;
                        </button>
                        <span className="cart-qty-value">{item.quantity}</span>
                        <button
                          className="cart-qty-btn"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={updating === item.id || item.quantity >= item.stock}
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="cart-remove-btn"
                        onClick={() => removeItem(item.id)}
                        disabled={updating === item.id}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="cart-item-price">
                    {formatPrice(item.lineTotal)}
                  </div>
                </div>
              ))}
            </div>

            {/* Order Summary */}
            <div className="cart-summary">
              <h3>Order Summary</h3>
              <div className="cart-summary-row">
                <span>Subtotal ({totalItems} item{totalItems !== 1 ? 's' : ''})</span>
                <span>{formatPrice(cart.totalAmount)}</span>
              </div>
              <div className="cart-summary-row">
                <span>Delivery</span>
                <span className="free">FREE</span>
              </div>
              <hr className="cart-summary-divider" />
              <div className="cart-summary-total">
                <span>Total</span>
                <span>{formatPrice(cart.totalAmount)}</span>
              </div>
              <div className="cart-summary-savings">
                You save on delivery!
              </div>
              <button
                className="cart-checkout-btn"
                onClick={() => router.push('/checkout')}
              >
                Proceed to Checkout
              </button>
              <Link href="/" className="cart-continue-link">
                Continue Shopping
              </Link>
              <div className="cart-secure-note">
                <span>&#128274;</span> Secure checkout
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
