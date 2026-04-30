'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
  productId?: string;
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

/** Read a single cookie's value by name, or null if absent. Used to
 *  pull the affiliate referral cookie (sm_ref) at checkout time. */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  const v = match.slice(name.length + 1);
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
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
  const [placedOrderNumber, setPlacedOrderNumber] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [removingUnserviceable, setRemovingUnserviceable] = useState(false);
  const [error, setError] = useState('');
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);

  // Coupon state
  const [couponInput, setCouponInput] = useState('');
  const [couponApplying, setCouponApplying] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    title: string | null;
    valueType: string;
    value: number;
    discountAmount: number;
  } | null>(null);

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
      const data = await apiClient<any>(`/pincodes/${pincode}`);

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

  const validateAddressField = (name: string, value: string): string => {
    const v = (value || '').trim();
    switch (name) {
      case 'fullName':
        if (!v) return 'Full name is required';
        if (v.length < 2) return 'Name is too short';
        if (!/^[A-Za-z][A-Za-z .'-]*$/.test(v)) return 'Use letters, spaces, . ’ - only';
        return '';
      case 'phone': {
        if (!v) return 'Phone is required';
        const digits = v.replace(/\D/g, '');
        const local =
          digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
        if (local.length !== 10) return 'Enter a valid 10-digit phone number';
        if (!/^[6-9]/.test(local)) return 'Indian mobiles start with 6-9';
        return '';
      }
      case 'addressLine1':
        if (!v) return 'Address is required';
        if (v.length < 4) return 'Address is too short';
        return '';
      case 'postalCode':
        if (!v) return 'Pincode is required';
        if (!/^\d{6}$/.test(v)) return 'Pincode must be 6 digits';
        return '';
      case 'city':
        if (!v) return 'City is required';
        return '';
      case 'state':
        if (!v) return 'State is required';
        return '';
      default:
        return '';
    }
  };

  const validateAddressForm = (f: typeof form): Record<string, string> => {
    const errs: Record<string, string> = {};
    (['fullName', 'phone', 'addressLine1', 'postalCode', 'city', 'state'] as const).forEach((k) => {
      const e = validateAddressField(k, (f as Record<string, string>)[k] ?? '');
      if (e) errs[k] = e;
    });
    return errs;
  };

  const clearFieldError = (name: string) => {
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const resetAddressForm = () => {
    setForm({ fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', locality: '' });
    setFieldErrors({});
    setPincodeData(null);
    setPincodeError('');
    setPincodeAutoFilled(false);
    setSelectedPlace('');
    setEditingAddressId(null);
  };

  const startEditAddress = (addr: Address) => {
    setEditingAddressId(addr.id);
    setForm({
      fullName: addr.fullName || '',
      phone: addr.phone || '',
      addressLine1: addr.addressLine1 || '',
      addressLine2: addr.addressLine2 || '',
      city: addr.city || '',
      state: addr.state || '',
      postalCode: addr.postalCode || '',
      locality: '',
    });
    setFieldErrors({});
    setPincodeData(null);
    setPincodeError('');
    setPincodeAutoFilled(false);
    setSelectedPlace('');
    setShowNewAddress(true);
    setError('');
  };

  const handleCreateAddress = async () => {
    const errs = validateAddressForm(form);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError('Please fix the highlighted fields');
      return;
    }
    setError('');
    const isEditing = !!editingAddressId;
    try {
      const res = isEditing
        ? await apiClient<Address>(`/customer/addresses/${editingAddressId}`, {
            method: 'PATCH',
            body: JSON.stringify(form),
          })
        : await apiClient<Address>('/customer/addresses', {
            method: 'POST',
            body: JSON.stringify(form),
          });
      if (res.data) {
        if (isEditing) {
          setAddresses((prev) => prev.map((a) => (a.id === res.data!.id ? res.data! : a)));
          // If the edited address was selected, keep it selected & reset any
          // cached serviceability/allocation tied to the old values.
          if (selectedAddressId === res.data.id) {
            setCheckoutData(null);
          }
        } else {
          setAddresses((prev) => [res.data!, ...prev]);
          setSelectedAddressId(res.data.id);
        }
        setShowNewAddress(false);
        resetAddressForm();
      }
    } catch (err: any) {
      setError(err?.body?.message || err?.message || 'Failed to save address');
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

  // Apply coupon (validates against current serviceable subtotal)
  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      setCouponError('Enter a coupon code');
      return;
    }
    const subtotalForValidation = checkoutData
      ? checkoutData.serviceableAmount
      : cart?.totalAmount ?? 0;
    // Send line items so BXGY coupons (and any product-scoped rules) can
    // evaluate which cart items qualify. Prefer the post-allocation
    // checkoutData items (serviceable only); fall back to the raw cart.
    const itemsForValidation = checkoutData
      ? checkoutData.items
          .filter((i) => i.serviceable)
          .map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          }))
      : (cart?.items ?? []).map((i) => ({
          productId: i.productId ?? '',
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        }));
    setCouponApplying(true);
    setCouponError('');
    try {
      const res = await apiClient<{
        code: string;
        title: string | null;
        valueType: string;
        value: number;
        discountAmount: number;
      }>('/customer/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({
          code,
          subtotal: subtotalForValidation,
          items: itemsForValidation,
        }),
      });
      if (res.data) {
        setAppliedCoupon(res.data);
        setCouponInput(res.data.code);
      }
    } catch (err: any) {
      setCouponError(err?.body?.message || err?.message || 'Invalid coupon');
      setAppliedCoupon(null);
    } finally {
      setCouponApplying(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput('');
    setCouponError('');
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
    // 60-second client-side timeout so the button can never hang forever.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      // Affiliate referral cookie (SRS §7.1). If the customer arrived
      // via `?ref=AFXXXX` at any point in the last 30 days, the
      // sm_ref cookie still carries that value — pass it along so
      // the order gets attributed even if no coupon is applied.
      const referralCode = readCookie('sm_ref');
      const res = await apiClient<{ orderNumber: string }>('/customer/checkout/place-order', {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod: 'COD',
          ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
          ...(referralCode ? { referralCode } : {}),
        }),
        signal: abort.signal,
      });
      window.dispatchEvent(new Event('cart-updated'));
      const orderNumber = res?.data?.orderNumber;
      if (!orderNumber) {
        setError('Order placed but confirmation was missing. Check My Orders.');
        setPlacing(false);
        return;
      }
      // Flip to a success screen immediately so the user isn't staring at
      // "Placing Order..." while Next.js compiles/loads /orders/[id] in dev
      // mode. Kick off the navigation in the background.
      setPlacedOrderNumber(orderNumber);
      router.prefetch(`/orders/${orderNumber}`);
      router.replace(`/orders/${orderNumber}`);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setError('The server took too long to respond. Please check My Orders — your order may still have been placed.');
      } else {
        setError(err?.message || 'Failed to place order');
      }
      setPlacing(false);
    } finally {
      clearTimeout(timer);
    }
  };

  const formatPrice = (price: number) => `\u20B9${Number(price).toLocaleString('en-IN')}`;

  useEffect(() => {
    if (!appliedCoupon) return;
    const currentSubtotal = checkoutData
      ? checkoutData.serviceableAmount
      : cart?.totalAmount ?? 0;
    if (appliedCoupon.discountAmount > Number(currentSubtotal) + 0.01) {
      setAppliedCoupon(null);
      setCouponError('Coupon removed — the order total changed. Re-apply if needed.');
    }
  }, [checkoutData, cart?.totalAmount, appliedCoupon]);

  // Redirect empty-cart visitors to /cart. Runs in useEffect because
  // calling router.push() during render updates Router state mid-render
  // and React refuses (`Cannot update a component while rendering a
  // different component`). Gate on !loading so we don't bounce the
  // user while the initial cart fetch is still in flight.
  useEffect(() => {
    if (!loading && (!cart || cart.items.length === 0)) {
      router.push('/cart');
    }
  }, [loading, cart, router]);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">Loading checkout...</div>
      </>
    );
  }

  if (!cart || cart.items.length === 0) {
    // Render a blank shell while the useEffect above queues the
    // redirect. No router.push() here — doing so would re-trigger the
    // setState-during-render error.
    return null;
  }

  // Success overlay shown from the moment the server confirms the order.
  // Takes over the viewport so the user isn't watching a "Placing Order…"
  // button while Next.js compiles/loads /orders/[orderNumber] in dev mode.
  if (placedOrderNumber) {
    return (
      <>
        <Navbar />
        <div
          style={{
            minHeight: '70vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '32px 28px',
              textAlign: 'center',
              maxWidth: 420,
              width: '100%',
              boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: '#d1fae5',
                color: '#16a34a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 30,
                fontWeight: 700,
                margin: '0 auto 16px',
              }}
            >
              ✓
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#111' }}>
              Order placed
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#4b5563' }}>
              Order #{placedOrderNumber}
            </p>
            <p
              style={{
                margin: '18px 0 0',
                fontSize: 13,
                color: '#6b7280',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 14,
                  height: 14,
                  border: '2px solid #d1d5db',
                  borderTopColor: '#2563eb',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'sm-spin 0.8s linear infinite',
                }}
              />
              Opening your order…
            </p>
            <div style={{ marginTop: 18 }}>
              <Link
                href={`/orders/${placedOrderNumber}`}
                style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}
              >
                Tap here if the page doesn&apos;t load
              </Link>
            </div>
          </div>
        </div>
        <style>{`@keyframes sm-spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
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
                  <div
                    key={addr.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: 14,
                      border: `2px solid ${selectedAddressId === addr.id ? '#111' : '#e5e7eb'}`,
                      borderRadius: 8,
                      marginBottom: 8,
                    }}
                  >
                    <label style={{ flex: 1, cursor: 'pointer' }}>
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
                    <button
                      type="button"
                      onClick={() => startEditAddress(addr)}
                      style={{
                        flex: '0 0 auto',
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: '4px 8px',
                      }}
                    >
                      Edit
                    </button>
                  </div>
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
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                  {editingAddressId ? 'Edit Address' : 'New Address'}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <input
                      placeholder="Full Name *"
                      value={form.fullName}
                      maxLength={60}
                      onChange={(e) => {
                        // Strip anything that isn't a letter, space, . ' -
                        const cleaned = e.target.value.replace(/[^A-Za-z .'\-]/g, '');
                        setForm({ ...form, fullName: cleaned });
                        clearFieldError('fullName');
                      }}
                      onBlur={(e) => {
                        const msg = validateAddressField('fullName', e.target.value);
                        setFieldErrors((p) => ({ ...p, fullName: msg })) ;
                      }}
                      style={{ ...inputStyle, borderColor: fieldErrors.fullName ? '#dc2626' : inputStyle.borderColor }}
                      aria-invalid={!!fieldErrors.fullName}
                    />
                    {fieldErrors.fullName && (
                      <span style={{ fontSize: 12, color: '#dc2626', marginTop: 4, display: 'block' }}>{fieldErrors.fullName}</span>
                    )}
                  </div>
                  <div>
                    <input
                      placeholder="Phone *"
                      value={form.phone}
                      inputMode="numeric"
                      maxLength={10}
                      onChange={(e) => {
                        // Keep digits only, drop leading 0-5 so first digit must be 6-9,
                        // cap at 10 digits.
                        let digits = e.target.value.replace(/\D/g, '');
                        while (digits.length > 0 && !/^[6-9]/.test(digits)) {
                          digits = digits.slice(1);
                        }
                        digits = digits.slice(0, 10);
                        setForm({ ...form, phone: digits });
                        clearFieldError('phone');
                      }}
                      onBlur={(e) => {
                        const msg = validateAddressField('phone', e.target.value);
                        setFieldErrors((p) => ({ ...p, phone: msg }));
                      }}
                      style={{ ...inputStyle, borderColor: fieldErrors.phone ? '#dc2626' : inputStyle.borderColor }}
                      aria-invalid={!!fieldErrors.phone}
                    />
                    {fieldErrors.phone && (
                      <span style={{ fontSize: 12, color: '#dc2626', marginTop: 4, display: 'block' }}>{fieldErrors.phone}</span>
                    )}
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <input
                      placeholder="Address Line 1 *"
                      value={form.addressLine1}
                      onChange={(e) => { setForm({ ...form, addressLine1: e.target.value }); clearFieldError('addressLine1'); }}
                      onBlur={(e) => {
                        const msg = validateAddressField('addressLine1', e.target.value);
                        setFieldErrors((p) => ({ ...p, addressLine1: msg }));
                      }}
                      style={{ ...inputStyle, borderColor: fieldErrors.addressLine1 ? '#dc2626' : inputStyle.borderColor, width: '100%' }}
                      aria-invalid={!!fieldErrors.addressLine1}
                    />
                    {fieldErrors.addressLine1 && (
                      <span style={{ fontSize: 12, color: '#dc2626', marginTop: 4, display: 'block' }}>{fieldErrors.addressLine1}</span>
                    )}
                  </div>
                  <input placeholder="Address Line 2" value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} style={{ ...inputStyle, gridColumn: '1 / -1' }} />
                  <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <input
                        placeholder="Postal Code (PIN) *"
                        value={form.postalCode}
                        inputMode="numeric"
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setForm({ ...form, postalCode: val });
                          clearFieldError('postalCode');
                          lookupPincode(val);
                        }}
                        onBlur={(e) => {
                          const msg = validateAddressField('postalCode', e.target.value);
                          setFieldErrors((p) => ({ ...p, postalCode: msg }));
                        }}
                        style={{ ...inputStyle, borderColor: fieldErrors.postalCode ? '#dc2626' : inputStyle.borderColor }}
                        maxLength={6}
                        aria-invalid={!!fieldErrors.postalCode}
                      />
                      {fieldErrors.postalCode && (
                        <span style={{ fontSize: 12, color: '#dc2626', marginTop: 4, display: 'block' }}>{fieldErrors.postalCode}</span>
                      )}
                      {!fieldErrors.postalCode && pincodeLoading && (
                        <span style={{ fontSize: 12, color: '#6b7280', marginTop: 4, display: 'block' }}>Looking up pincode...</span>
                      )}
                      {!fieldErrors.postalCode && pincodeError && (
                        <span style={{ fontSize: 12, color: '#dc2626', marginTop: 4, display: 'block' }}>{pincodeError}</span>
                      )}
                      {!fieldErrors.postalCode && pincodeData && !pincodeError && (
                        <span style={{ fontSize: 12, color: '#16a34a', marginTop: 4, display: 'block' }}>{pincodeData.district}, {pincodeData.state}</span>
                      )}
                    </div>
                    <div />
                  </div>
                  <div>
                    <input
                      placeholder="City / District *"
                      value={form.city}
                      onChange={(e) => {
                        setForm({ ...form, city: e.target.value });
                        clearFieldError('city');
                        if (pincodeAutoFilled) setPincodeAutoFilled(false);
                      }}
                      onBlur={(e) => {
                        const msg = validateAddressField('city', e.target.value);
                        setFieldErrors((p) => ({ ...p, city: msg }));
                      }}
                      style={{
                        ...inputStyle,
                        borderColor: fieldErrors.city ? '#dc2626' : (pincodeAutoFilled ? '#86efac' : inputStyle.borderColor),
                        ...(pincodeAutoFilled ? { background: '#f0fdf4' } : {}),
                      }}
                      readOnly={pincodeAutoFilled}
                      aria-invalid={!!fieldErrors.city}
                    />
                    {fieldErrors.city && (
                      <span style={{ fontSize: 12, color: '#dc2626', marginTop: 4, display: 'block' }}>{fieldErrors.city}</span>
                    )}
                  </div>
                  <div>
                    <input
                      placeholder="State *"
                      value={form.state}
                      onChange={(e) => {
                        setForm({ ...form, state: e.target.value });
                        clearFieldError('state');
                        if (pincodeAutoFilled) setPincodeAutoFilled(false);
                      }}
                      onBlur={(e) => {
                        const msg = validateAddressField('state', e.target.value);
                        setFieldErrors((p) => ({ ...p, state: msg }));
                      }}
                      style={{
                        ...inputStyle,
                        borderColor: fieldErrors.state ? '#dc2626' : (pincodeAutoFilled ? '#86efac' : inputStyle.borderColor),
                        ...(pincodeAutoFilled ? { background: '#f0fdf4' } : {}),
                      }}
                      aria-invalid={!!fieldErrors.state}
                    />
                    {fieldErrors.state && (
                      <span style={{ fontSize: 12, color: '#dc2626', marginTop: 4, display: 'block' }}>{fieldErrors.state}</span>
                    )}
                  </div>
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
                    {editingAddressId ? 'Update Address' : 'Save Address'}
                  </button>
                  {(addresses.length > 0 || editingAddressId) && (
                    <button
                      onClick={() => {
                        setShowNewAddress(false);
                        resetAddressForm();
                      }}
                      style={{ padding: '10px 20px', background: 'none', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}
                    >
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

            {/* Coupon input */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Have a coupon?</div>
              {appliedCoupon ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '10px 12px',
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: 8,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#065f46' }}>
                      {appliedCoupon.code} applied
                    </div>
                    <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>
                      You save {formatPrice(appliedCoupon.discountAmount)}
                      {appliedCoupon.valueType === 'PERCENTAGE' ? ` (${appliedCoupon.value}% off)` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveCoupon}
                    style={{
                      flex: '0 0 auto',
                      background: 'none',
                      border: 'none',
                      color: '#065f46',
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: 'underline',
                      cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      placeholder="Enter coupon code"
                      value={couponInput}
                      maxLength={40}
                      onChange={(e) => {
                        setCouponInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''));
                        if (couponError) setCouponError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !couponApplying) {
                          e.preventDefault();
                          handleApplyCoupon();
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '9px 11px',
                        borderWidth: 1,
                        borderStyle: 'solid',
                        borderColor: couponError ? '#dc2626' : '#d1d5db',
                        borderRadius: 8,
                        fontSize: 13,
                        outline: 'none',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                      aria-invalid={!!couponError}
                    />
                    <button
                      type="button"
                      onClick={handleApplyCoupon}
                      disabled={couponApplying || !couponInput.trim()}
                      style={{
                        padding: '9px 14px',
                        background: !couponInput.trim() || couponApplying ? '#9ca3af' : '#111',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: !couponInput.trim() || couponApplying ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {couponApplying ? 'Applying...' : 'Apply'}
                    </button>
                  </div>
                  {couponError && (
                    <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>
                      {couponError}
                    </div>
                  )}
                </>
              )}
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
                {appliedCoupon && appliedCoupon.discountAmount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14, color: '#16a34a' }}>
                    <span>Coupon ({appliedCoupon.code})</span>
                    <span>-{formatPrice(appliedCoupon.discountAmount)}</span>
                  </div>
                )}
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                  <span>Total</span>
                  <span>{formatPrice(Math.max(0, checkoutData.serviceableAmount - (appliedCoupon?.discountAmount ?? 0)))}</span>
                </div>

                {/* Reservation timer */}
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8, textAlign: 'center' }}>
                  Stock reserved until {new Date(checkoutData.expiresAt).toLocaleTimeString()}
                </div>

                <button
                  onClick={handlePlaceOrder}
                  disabled={placing || !checkoutData.allServiceable || checkoutData.items.length === 0}
                  aria-busy={placing}
                  style={{
                    width: '100%',
                    marginTop: 16,
                    padding: '14px 20px',
                    fontSize: 15,
                    fontWeight: 700,
                    border: 'none',
                    background: !checkoutData.allServiceable ? '#9ca3af' : '#111',
                    color: '#fff',
                    borderRadius: 8,
                    cursor: (placing || !checkoutData.allServiceable) ? 'not-allowed' : 'pointer',
                    opacity: placing ? 0.85 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    transition: 'opacity 120ms ease',
                  }}
                >
                  {placing && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 16,
                        height: 16,
                        border: '2px solid rgba(255,255,255,0.35)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        display: 'inline-block',
                        animation: 'sm-spin 0.8s linear infinite',
                      }}
                    />
                  )}
                  {placing
                    ? 'Placing Order...'
                    : !checkoutData.allServiceable
                      ? 'Remove Unserviceable Items First'
                      : 'Place Order (COD)'}
                </button>
                <style>{`@keyframes sm-spin { to { transform: rotate(360deg); } }`}</style>
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
                {appliedCoupon && appliedCoupon.discountAmount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14, color: '#16a34a' }}>
                    <span>Coupon ({appliedCoupon.code})</span>
                    <span>-{formatPrice(appliedCoupon.discountAmount)}</span>
                  </div>
                )}
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                  <span>Total</span>
                  <span>{formatPrice(Math.max(0, cart.totalAmount - (appliedCoupon?.discountAmount ?? 0)))}</span>
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
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#d1d5db',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
};
