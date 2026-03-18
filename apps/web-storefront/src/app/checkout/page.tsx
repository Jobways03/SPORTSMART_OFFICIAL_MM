'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { apiClient } from '@/lib/api-client';

interface Address {
  id: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
}

interface CartItem {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

interface CartData {
  items: CartItem[];
  totalAmount: number;
  itemCount: number;
}

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartData | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  // New address form
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
  });

  useEffect(() => {
    try {
      const token = sessionStorage.getItem('accessToken');
      if (!token) { router.push('/login'); return; }
    } catch { router.push('/login'); return; }

    Promise.all([
      apiClient<CartData>('/customer/cart'),
      apiClient<Address[]>('/customer/addresses'),
    ])
      .then(([cartRes, addrRes]) => {
        if (cartRes.data) setCart(cartRes.data);
        if (addrRes.data) {
          setAddresses(addrRes.data);
          if (addrRes.data.length > 0) {
            setSelectedAddressId(addrRes.data[0].id);
          } else {
            setShowNewAddress(true);
          }
        }
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, []);

  const handleCreateAddress = async () => {
    const { fullName, phone, addressLine1, city, state, postalCode } = form;
    if (!fullName || !phone || !addressLine1 || !city || !state || !postalCode) {
      setError('Please fill all required address fields');
      return;
    }
    setError('');
    try {
      const res = await apiClient<Address>('/customer/addresses', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (res.data) {
        setAddresses((prev) => [res.data!, ...prev]);
        setSelectedAddressId(res.data.id);
        setShowNewAddress(false);
        setForm({ fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '' });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save address');
    }
  };

  const handlePlaceOrder = async () => {
    if (!selectedAddressId) {
      setError('Please select or add a shipping address');
      return;
    }
    setPlacing(true);
    setError('');
    try {
      const res = await apiClient<{ orderNumber: string }>('/customer/orders', {
        method: 'POST',
        body: JSON.stringify({ addressId: selectedAddressId }),
      });
      window.dispatchEvent(new Event('cart-updated'));
      if (res.data) {
        router.push(`/orders/${res.data.orderNumber}`);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to place order');
    } finally {
      setPlacing(false);
    }
  };

  const formatPrice = (price: number) => `\u20B9${Number(price).toLocaleString('en-IN')}`;

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">Loading checkout...</div>
      </>
    );
  }

  if (!cart || cart.items.length === 0) {
    router.push('/cart');
    return null;
  }

  return (
    <>
      <Navbar />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 60px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Checkout</h1>

        {error && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#991b1b', fontSize: 14 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {/* Left: Shipping Address */}
          <div style={{ flex: '1 1 400px' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Shipping Address</h2>

            {addresses.length > 0 && !showNewAddress && (
              <div style={{ marginBottom: 16 }}>
                {addresses.map((addr) => (
                  <label
                    key={addr.id}
                    style={{
                      display: 'block',
                      padding: 14,
                      border: `2px solid ${selectedAddressId === addr.id ? '#111' : '#e5e7eb'}`,
                      borderRadius: 8,
                      marginBottom: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="address"
                      checked={selectedAddressId === addr.id}
                      onChange={() => setSelectedAddressId(addr.id)}
                      style={{ marginRight: 10 }}
                    />
                    <strong>{addr.fullName}</strong> - {addr.phone}
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4, marginLeft: 24 }}>
                      {addr.addressLine1}{addr.addressLine2 && `, ${addr.addressLine2}`}, {addr.city}, {addr.state} - {addr.postalCode}
                    </div>
                  </label>
                ))}
                <button
                  onClick={() => setShowNewAddress(true)}
                  style={{ marginTop: 8, border: '1px dashed #d1d5db', background: 'none', borderRadius: 8, padding: '10px 16px', width: '100%', cursor: 'pointer', color: '#6b7280', fontSize: 14 }}
                >
                  + Add new address
                </button>
              </div>
            )}

            {showNewAddress && (
              <div style={{ background: '#f9fafb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>New Address</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input placeholder="Full Name *" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} style={inputStyle} />
                  <input placeholder="Phone *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={inputStyle} />
                  <input placeholder="Address Line 1 *" value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} style={{ ...inputStyle, gridColumn: '1 / -1' }} />
                  <input placeholder="Address Line 2" value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} style={{ ...inputStyle, gridColumn: '1 / -1' }} />
                  <input placeholder="City *" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} style={inputStyle} />
                  <input placeholder="State *" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} style={inputStyle} />
                  <input placeholder="Postal Code *" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} style={inputStyle} />
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <button onClick={handleCreateAddress} style={{ padding: '10px 20px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    Save Address
                  </button>
                  {addresses.length > 0 && (
                    <button onClick={() => setShowNewAddress(false)} style={{ padding: '10px 20px', background: 'none', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Order items summary */}
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, marginTop: 24 }}>Order Items</h2>
            {cart.items.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 12, paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ width: 50, height: 50, borderRadius: 6, background: '#f3f4f6', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 20, color: '#d1d5db' }}>&#128722;</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{item.productTitle}</div>
                  {item.variantTitle && <div style={{ fontSize: 12, color: '#6b7280' }}>{item.variantTitle}</div>}
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Qty: {item.quantity}</div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{formatPrice(item.lineTotal)}</div>
              </div>
            ))}
          </div>

          {/* Right: Summary + Place Order */}
          <div style={{
            flex: '0 0 280px',
            background: '#f9fafb',
            borderRadius: 12,
            padding: 20,
            height: 'fit-content',
            position: 'sticky',
            top: 80,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Payment</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: 12, background: '#fff', borderRadius: 8, border: '2px solid #111' }}>
              <span style={{ fontSize: 18 }}>&#128176;</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Cash on Delivery</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Pay when you receive</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
              <span>Subtotal ({cart.itemCount} items)</span>
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
              onClick={handlePlaceOrder}
              disabled={placing || !selectedAddressId}
              style={{
                width: '100%',
                marginTop: 16,
                padding: '14px 20px',
                fontSize: 15,
                fontWeight: 700,
                border: 'none',
                background: placing ? '#9ca3af' : '#111',
                color: '#fff',
                borderRadius: 8,
                cursor: placing ? 'not-allowed' : 'pointer',
              }}
            >
              {placing ? 'Placing Order...' : 'Place Order (COD)'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
};
