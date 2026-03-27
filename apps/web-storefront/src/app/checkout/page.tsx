'use client';

import { useEffect, useState, useCallback } from 'react';
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

interface CheckoutItem {
  cartItemId: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  serviceable: boolean;
  unserviceableReason?: string;
  allocatedSellerName: string | null;
  estimatedDeliveryDays: number | null;
  reservationId: string | null;
}

interface CheckoutData {
  items: CheckoutItem[];
  totalAmount: number;
  serviceableAmount: number;
  itemCount: number;
  allServiceable: boolean;
  unserviceableCount: number;
  addressSnapshot: Record<string, string>;
  expiresAt: string;
}

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartData | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initiating, setInitiating] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [removingUnserviceable, setRemovingUnserviceable] = useState(false);
  const [error, setError] = useState('');
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);

  // New address form
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    locality: '',
  });

  // Pincode auto-fill state
  const [pincodeData, setPincodeData] = useState<{ district: string; state: string; places: { name: string; type: string; delivery: string }[] } | null>(null);
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [pincodeError, setPincodeError] = useState('');
  const [selectedPlace, setSelectedPlace] = useState('');
  const [pincodeAutoFilled, setPincodeAutoFilled] = useState(false);

  async function lookupPincode(pincode: string) {
    if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      setPincodeData(null);
      setPincodeError('');
      setPincodeAutoFilled(false);
      setSelectedPlace('');
      return;
    }

    setPincodeLoading(true);
    setPincodeError('');
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const res = await fetch(`${API_BASE}/api/v1/pincodes/${pincode}`);
      const data = await res.json();

      if (data.success && data.data) {
        setPincodeData(data.data);
        setPincodeAutoFilled(true);
        setSelectedPlace('');
        setForm(prev => ({
          ...prev,
          city: data.data.district,
          state: data.data.state,
        }));
      } else {
        setPincodeError('Invalid pincode');
        setPincodeData(null);
        setPincodeAutoFilled(false);
        setSelectedPlace('');
        setForm(prev => ({ ...prev, city: '', state: '' }));
      }
    } catch {
      setPincodeError('Failed to lookup pincode');
      setPincodeData(null);
      setPincodeAutoFilled(false);
    } finally {
      setPincodeLoading(false);
    }
  }

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
        setForm({ fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', locality: '' });
        setPincodeData(null);
        setPincodeError('');
        setPincodeAutoFilled(false);
        setSelectedPlace('');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save address');
    }
  };

  // T3/T6: Initiate checkout with seller allocation
  const handleInitiateCheckout = useCallback(async () => {
    if (!selectedAddressId) {
      setError('Please select or add a shipping address');
      return;
    }
    setInitiating(true);
    setError('');
    setCheckoutData(null);
    try {
      const res = await apiClient<CheckoutData>('/customer/checkout/initiate', {
        method: 'POST',
        body: JSON.stringify({ addressId: selectedAddressId }),
      });
      if (res.data) {
        setCheckoutData(res.data);
        if (!res.data.allServiceable) {
          setError(res.message || `${res.data.unserviceableCount} item(s) cannot be delivered to this address`);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to initiate checkout');
    } finally {
      setInitiating(false);
    }
  }, [selectedAddressId]);

  // T8: Remove unserviceable items
  const handleRemoveUnserviceable = async () => {
    setRemovingUnserviceable(true);
    setError('');
    try {
      const res = await apiClient<CheckoutData>('/customer/checkout/remove-unserviceable', {
        method: 'POST',
      });
      if (res.data) {
        setCheckoutData((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            items: res.data!.items,
            totalAmount: res.data!.totalAmount,
            itemCount: res.data!.itemCount,
            allServiceable: res.data!.allServiceable,
            serviceableAmount: prev.serviceableAmount,
            unserviceableCount: 0,
            addressSnapshot: prev.addressSnapshot,
            expiresAt: prev.expiresAt,
          };
        });
        // Also update the cart display
        const cartRes = await apiClient<CartData>('/customer/cart');
        if (cartRes.data) setCart(cartRes.data);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to remove unserviceable items');
    } finally {
      setRemovingUnserviceable(false);
    }
  };

  // Place order via the new checkout endpoint
  const handlePlaceOrder = async () => {
    if (!checkoutData) {
      setError('Please initiate checkout first');
      return;
    }
    if (!checkoutData.allServiceable) {
      setError('Please remove unserviceable items before placing your order');
      return;
    }
    setPlacing(true);
    setError('');
    try {
      const res = await apiClient<{ orderNumber: string }>('/customer/checkout/place-order', {
        method: 'POST',
        body: JSON.stringify({ paymentMethod: 'COD' }),
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
          {/* Left column */}
          <div style={{ flex: '1 1 400px' }}>
            {/* ── Step 1: Shipping Address ────────────────────────────── */}
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
                      onChange={() => {
                        setSelectedAddressId(addr.id);
                        setCheckoutData(null); // Reset checkout when address changes
                      }}
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
                  <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <input
                        placeholder="Postal Code (PIN) *"
                        value={form.postalCode}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setForm({ ...form, postalCode: val });
                          lookupPincode(val);
                        }}
                        style={inputStyle}
                        maxLength={6}
                      />
                      {pincodeLoading && (
                        <span style={{ fontSize: 12, color: '#6b7280', marginTop: 4, display: 'block' }}>Looking up pincode...</span>
                      )}
                      {pincodeError && (
                        <span style={{ fontSize: 12, color: '#dc2626', marginTop: 4, display: 'block' }}>{pincodeError}</span>
                      )}
                      {pincodeData && !pincodeError && (
                        <span style={{ fontSize: 12, color: '#16a34a', marginTop: 4, display: 'block' }}>{pincodeData.district}, {pincodeData.state}</span>
                      )}
                    </div>
                    <div />
                  </div>
                  <input
                    placeholder="City / District *"
                    value={form.city}
                    onChange={(e) => {
                      setForm({ ...form, city: e.target.value });
                      if (pincodeAutoFilled) setPincodeAutoFilled(false);
                    }}
                    style={{
                      ...inputStyle,
                      ...(pincodeAutoFilled ? { background: '#f0fdf4', borderColor: '#86efac' } : {}),
                    }}
                    readOnly={pincodeAutoFilled}
                  />
                  <input
                    placeholder="State *"
                    value={form.state}
                    onChange={(e) => {
                      setForm({ ...form, state: e.target.value });
                      if (pincodeAutoFilled) setPincodeAutoFilled(false);
                    }}
                    style={{
                      ...inputStyle,
                      ...(pincodeAutoFilled ? { background: '#f0fdf4', borderColor: '#86efac' } : {}),
                    }}
                  />
                  {pincodeData && pincodeData.places && pincodeData.places.length > 0 && (
                    <select
                      value={selectedPlace}
                      onChange={(e) => { setSelectedPlace(e.target.value); setForm(prev => ({ ...prev, locality: e.target.value })); }}
                      style={{ ...inputStyle, gridColumn: '1 / -1', cursor: 'pointer' }}
                    >
                      <option value="">Select your locality</option>
                      {pincodeData.places.map((place, idx) => (
                        <option key={idx} value={place.name}>{place.name}</option>
                      ))}
                    </select>
                  )}
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

            {/* ── Step 2: Check Serviceability ─────────────────────── */}
            {!checkoutData && (
              <div style={{ marginTop: 16, marginBottom: 24 }}>
                <button
                  onClick={handleInitiateCheckout}
                  disabled={initiating || !selectedAddressId}
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    fontSize: 15,
                    fontWeight: 700,
                    border: 'none',
                    background: initiating ? '#9ca3af' : '#2563eb',
                    color: '#fff',
                    borderRadius: 8,
                    cursor: initiating ? 'not-allowed' : 'pointer',
                  }}
                >
                  {initiating ? 'Checking availability...' : 'Check Delivery & Continue'}
                </button>
              </div>
            )}

            {/* ── Step 3: Allocated Items ──────────────────────────── */}
            {checkoutData && (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, marginTop: 24 }}>Order Items</h2>

                {/* Unserviceable banner */}
                {!checkoutData.allServiceable && (
                  <div style={{
                    background: '#fef3c7',
                    border: '1px solid #fbbf24',
                    borderRadius: 8,
                    padding: '12px 14px',
                    marginBottom: 16,
                    color: '#92400e',
                    fontSize: 14,
                  }}>
                    <strong>{checkoutData.unserviceableCount} item(s)</strong> cannot be delivered to your address.
                    Remove them to proceed.
                    <button
                      onClick={handleRemoveUnserviceable}
                      disabled={removingUnserviceable}
                      style={{
                        display: 'block',
                        marginTop: 8,
                        padding: '8px 16px',
                        background: '#92400e',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: removingUnserviceable ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {removingUnserviceable ? 'Removing...' : 'Remove Unserviceable Items'}
                    </button>
                  </div>
                )}

                {checkoutData.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      gap: 12,
                      paddingBottom: 12,
                      marginBottom: 12,
                      borderBottom: '1px solid #f3f4f6',
                      opacity: item.serviceable ? 1 : 0.55,
                    }}
                  >
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

                      {/* T4: Delivery estimate */}
                      {item.serviceable && item.estimatedDeliveryDays !== null && (
                        <div style={{ fontSize: 12, color: '#16a34a', marginTop: 2 }}>
                          Est. delivery: {item.estimatedDeliveryDays} day{item.estimatedDeliveryDays !== 1 ? 's' : ''}
                        </div>
                      )}

                      {/* T8: Unserviceable message */}
                      {!item.serviceable && (
                        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 2, fontWeight: 500 }}>
                          {item.unserviceableReason || 'This item cannot be delivered to your address'}
                        </div>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {item.serviceable ? formatPrice(item.lineTotal) : (
                        <span style={{ color: '#dc2626', textDecoration: 'line-through' }}>{formatPrice(item.lineTotal)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Fallback: show cart items if checkout not yet initiated */}
            {!checkoutData && (
              <>
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
              </>
            )}
          </div>

          {/* ── Right column: Summary + Place Order ───────────────── */}
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

            {checkoutData ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
                  <span>Subtotal ({checkoutData.itemCount} items)</span>
                  <span>{formatPrice(checkoutData.serviceableAmount)}</span>
                </div>
                {checkoutData.unserviceableCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, color: '#dc2626' }}>
                    <span>Unserviceable ({checkoutData.unserviceableCount})</span>
                    <span>-{formatPrice(checkoutData.totalAmount - checkoutData.serviceableAmount)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
                  <span>Delivery</span>
                  <span style={{ color: '#16a34a' }}>FREE</span>
                </div>
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                  <span>Total</span>
                  <span>{formatPrice(checkoutData.serviceableAmount)}</span>
                </div>

                {/* Reservation timer */}
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8, textAlign: 'center' }}>
                  Stock reserved until {new Date(checkoutData.expiresAt).toLocaleTimeString()}
                </div>

                <button
                  onClick={handlePlaceOrder}
                  disabled={placing || !checkoutData.allServiceable || checkoutData.items.length === 0}
                  style={{
                    width: '100%',
                    marginTop: 16,
                    padding: '14px 20px',
                    fontSize: 15,
                    fontWeight: 700,
                    border: 'none',
                    background: (placing || !checkoutData.allServiceable) ? '#9ca3af' : '#111',
                    color: '#fff',
                    borderRadius: 8,
                    cursor: (placing || !checkoutData.allServiceable) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {placing
                    ? 'Placing Order...'
                    : !checkoutData.allServiceable
                      ? 'Remove Unserviceable Items First'
                      : 'Place Order (COD)'}
                </button>
              </>
            ) : (
              <>
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
                  onClick={handleInitiateCheckout}
                  disabled={initiating || !selectedAddressId}
                  style={{
                    width: '100%',
                    marginTop: 16,
                    padding: '14px 20px',
                    fontSize: 15,
                    fontWeight: 700,
                    border: 'none',
                    background: initiating ? '#9ca3af' : '#111',
                    color: '#fff',
                    borderRadius: 8,
                    cursor: initiating ? 'not-allowed' : 'pointer',
                  }}
                >
                  {initiating ? 'Checking...' : 'Check Delivery & Continue'}
                </button>
              </>
            )}
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
