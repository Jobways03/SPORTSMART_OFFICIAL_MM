'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Wallet,
  Plus,
  Pencil,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Image as ImageIcon,
  ShieldCheck,
  Truck,
  Tag,
  ArrowRight,
} from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
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

const inputBase =
  'w-full h-11 px-3.5 border bg-white text-body placeholder:text-ink-400 focus:outline-none transition-colors rounded-full';
const inputOk = 'border-ink-300 hover:border-ink-500 focus:border-ink-900';
const inputErr = 'border-danger focus:border-danger';
const inputAuto = 'border-accent bg-accent-soft/40 focus:border-accent-dark';

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

  const [form, setForm] = useState({
    fullName: '', phone: '', addressLine1: '', addressLine2: '',
    city: '', state: '', postalCode: '', locality: '',
  });

  const [pincodeData, setPincodeData] = useState<{
    district: string;
    state: string;
    places: { name: string; type: string; delivery: string }[];
  } | null>(null);
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
        setForm((prev) => ({ ...prev, city: data.data.district, state: data.data.state }));
      } else {
        setPincodeError('Invalid pincode');
        setPincodeData(null);
        setPincodeAutoFilled(false);
        setSelectedPlace('');
        setForm((prev) => ({ ...prev, city: '', state: '' }));
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
      if (!token) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }
    Promise.all([
      apiClient<CartData>('/customer/cart'),
      apiClient<Address[]>('/customer/addresses'),
    ])
      .then(([cartRes, addrRes]) => {
        if (cartRes.data) setCart(cartRes.data);
        if (addrRes.data) {
          setAddresses(addrRes.data);
          if (addrRes.data.length > 0) setSelectedAddressId(addrRes.data[0].id);
          else setShowNewAddress(true);
        }
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            method: 'PATCH', body: JSON.stringify(form),
          })
        : await apiClient<Address>('/customer/addresses', {
            method: 'POST', body: JSON.stringify(form),
          });
      if (res.data) {
        if (isEditing) {
          setAddresses((prev) => prev.map((a) => (a.id === res.data!.id ? res.data! : a)));
          if (selectedAddressId === res.data.id) setCheckoutData(null);
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
        method: 'POST', body: JSON.stringify({ addressId: selectedAddressId }),
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
        const cartRes = await apiClient<CartData>('/customer/cart');
        if (cartRes.data) setCart(cartRes.data);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to remove unserviceable items');
    } finally {
      setRemovingUnserviceable(false);
    }
  };

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      setCouponError('Enter a coupon code');
      return;
    }
    const subtotalForValidation = checkoutData
      ? checkoutData.serviceableAmount
      : cart?.totalAmount ?? 0;
    const itemsForValidation = checkoutData
      ? checkoutData.items
          .filter((i) => i.serviceable)
          .map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice }))
      : (cart?.items ?? []).map((i) => ({
          productId: i.productId ?? '',
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        }));
    setCouponApplying(true);
    setCouponError('');
    try {
      const res = await apiClient<{
        code: string; title: string | null; valueType: string;
        value: number; discountAmount: number;
      }>('/customer/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({ code, subtotal: subtotalForValidation, items: itemsForValidation }),
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
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      const res = await apiClient<{ orderNumber: string }>('/customer/checkout/place-order', {
        method: 'POST',
        body: JSON.stringify({
          paymentMethod: 'COD',
          ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
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

  const formatPrice = (price: number) => `₹${Number(price).toLocaleString('en-IN')}`;
  const itemNoun = (n: number) => (n === 1 ? 'item' : 'items');

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

  useEffect(() => {
    if (!loading && (!cart || cart.items.length === 0)) router.push('/cart');
  }, [loading, cart, router]);

  if (loading) {
    return (
      <StorefrontShell>
        <div className="container-x py-12">
          <div className="h-8 w-32 bg-ink-100 animate-pulse mb-8" />
          <div className="grid lg:grid-cols-[1fr_360px] gap-8">
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 bg-ink-100 animate-pulse" />
              ))}
            </div>
            <div className="h-80 bg-ink-100 animate-pulse" />
          </div>
        </div>
      </StorefrontShell>
    );
  }

  if (!cart || cart.items.length === 0) return null;

  if (placedOrderNumber) {
    return (
      <StorefrontShell>
        <div className="container-x min-h-[70vh] flex items-center justify-center py-16">
          <div className="bg-white border border-ink-200 p-10 max-w-md w-full text-center rounded-2xl">
            <div className="size-16 mx-auto rounded-full bg-green-50 grid place-items-center mb-5">
              <CheckCircle2 className="size-8 text-success" strokeWidth={1.75} />
            </div>
            <h2 className="font-display text-h2 text-ink-900">Order placed</h2>
            <p className="mt-2 text-body text-ink-600 tabular">
              Order #{placedOrderNumber}
            </p>
            <p className="mt-5 inline-flex items-center gap-2 text-caption text-ink-500">
              <Loader2 className="size-3.5 animate-spin" />
              Opening your order…
            </p>
            <div className="mt-4">
              <Link
                href={`/orders/${placedOrderNumber}`}
                className="text-caption font-semibold text-accent-dark hover:text-ink-900 hover:underline underline-offset-2"
              >
                Tap here if the page doesn&apos;t load
              </Link>
            </div>
          </div>
        </div>
      </StorefrontShell>
    );
  }

  const currentSubtotal = checkoutData ? checkoutData.serviceableAmount : cart.totalAmount;
  const currentItemCount = checkoutData ? checkoutData.itemCount : cart.itemCount;
  const total = Math.max(0, currentSubtotal - (appliedCoupon?.discountAmount ?? 0));

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12">
        {/* Breadcrumb */}
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-3">
          <Link href="/" className="hover:text-ink-900">Home</Link>
          {' / '}
          <Link href="/cart" className="hover:text-ink-900">Cart</Link>
          {' / '}
          <span className="text-ink-900">Checkout</span>
        </div>

        <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
          <h1 className="font-display text-h1 text-ink-900 leading-none tracking-tight">
            Checkout
          </h1>
          <p className="text-body text-ink-600">
            {currentItemCount} {itemNoun(currentItemCount)} &middot; {formatPrice(total)}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-danger text-body"
          >
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_380px] gap-8 items-start">
          {/* ─── Left column ────────────────────────── */}
          <div>
            {/* Shipping address */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-h3 text-ink-900">Shipping address</h2>
                {addresses.length > 0 && !showNewAddress && (
                  <button
                    type="button"
                    onClick={() => { resetAddressForm(); setShowNewAddress(true); }}
                    className="inline-flex items-center gap-1.5 text-caption font-semibold text-accent-dark hover:text-ink-900 underline-offset-2 hover:underline"
                  >
                    <Plus className="size-3.5" />
                    Add new
                  </button>
                )}
              </div>

              {addresses.length > 0 && !showNewAddress && (
                <div className="space-y-2.5 mb-6">
                  {addresses.map((addr) => {
                    const selected = selectedAddressId === addr.id;
                    return (
                      <label
                        key={addr.id}
                        className={`flex items-start gap-3 p-4 cursor-pointer transition-colors border ${
                          selected
                            ? 'border-ink-900 bg-accent-soft/30'
                            : 'border-ink-200 hover:border-ink-500 bg-white'
                        }`}
                      >
                        <input
                          type="radio"
                          name="address"
                          checked={selected}
                          onChange={() => {
                            setSelectedAddressId(addr.id);
                            setCheckoutData(null);
                          }}
                          className="mt-1 accent-ink-900"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-body font-semibold text-ink-900">
                              {addr.fullName}
                            </span>
                            <span className="text-caption text-ink-600 tabular">
                              {addr.phone}
                            </span>
                          </div>
                          <p className="mt-1 text-body text-ink-700">
                            {addr.addressLine1}
                            {addr.addressLine2 ? `, ${addr.addressLine2}` : ''}, {addr.city}, {addr.state} - {addr.postalCode}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); startEditAddress(addr); }}
                          className="inline-flex items-center gap-1 text-caption font-semibold text-ink-700 hover:text-ink-900"
                        >
                          <Pencil className="size-3" />
                          Edit
                        </button>
                      </label>
                    );
                  })}
                </div>
              )}

              {showNewAddress && (
                <div className="bg-white border border-ink-200 p-5 mb-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-body font-semibold text-ink-900">
                      {editingAddressId ? 'Edit address' : 'New address'}
                    </h3>
                    {(addresses.length > 0 || editingAddressId) && (
                      <button
                        type="button"
                        onClick={() => { setShowNewAddress(false); resetAddressForm(); }}
                        aria-label="Close"
                        className="size-7 grid place-items-center text-ink-500 hover:text-ink-900 hover:bg-ink-100"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-1.5">
                        Full name
                      </label>
                      <input
                        value={form.fullName}
                        maxLength={60}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/[^A-Za-z .'\-]/g, '');
                          setForm({ ...form, fullName: cleaned });
                          clearFieldError('fullName');
                        }}
                        onBlur={(e) => {
                          const msg = validateAddressField('fullName', e.target.value);
                          setFieldErrors((p) => ({ ...p, fullName: msg }));
                        }}
                        placeholder="Riya Sharma"
                        aria-invalid={!!fieldErrors.fullName}
                        className={`${inputBase} ${fieldErrors.fullName ? inputErr : inputOk}`}
                      />
                      {fieldErrors.fullName && (
                        <p className="mt-1 text-caption text-danger">{fieldErrors.fullName}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-1.5">
                        Phone
                      </label>
                      <input
                        value={form.phone}
                        inputMode="numeric"
                        maxLength={10}
                        onChange={(e) => {
                          let digits = e.target.value.replace(/\D/g, '');
                          while (digits.length > 0 && !/^[6-9]/.test(digits)) digits = digits.slice(1);
                          digits = digits.slice(0, 10);
                          setForm({ ...form, phone: digits });
                          clearFieldError('phone');
                        }}
                        onBlur={(e) => {
                          const msg = validateAddressField('phone', e.target.value);
                          setFieldErrors((p) => ({ ...p, phone: msg }));
                        }}
                        placeholder="98xxxxxxxx"
                        aria-invalid={!!fieldErrors.phone}
                        className={`${inputBase} ${fieldErrors.phone ? inputErr : inputOk} tabular`}
                      />
                      {fieldErrors.phone && (
                        <p className="mt-1 text-caption text-danger">{fieldErrors.phone}</p>
                      )}
                    </div>
                    <div className="col-span-2">
                      <label className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-1.5">
                        Address line 1
                      </label>
                      <input
                        value={form.addressLine1}
                        onChange={(e) => { setForm({ ...form, addressLine1: e.target.value }); clearFieldError('addressLine1'); }}
                        onBlur={(e) => {
                          const msg = validateAddressField('addressLine1', e.target.value);
                          setFieldErrors((p) => ({ ...p, addressLine1: msg }));
                        }}
                        placeholder="House / flat / building"
                        aria-invalid={!!fieldErrors.addressLine1}
                        className={`${inputBase} ${fieldErrors.addressLine1 ? inputErr : inputOk}`}
                      />
                      {fieldErrors.addressLine1 && (
                        <p className="mt-1 text-caption text-danger">{fieldErrors.addressLine1}</p>
                      )}
                    </div>
                    <div className="col-span-2">
                      <label className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-1.5">
                        Address line 2 <span className="text-ink-400 normal-case">(optional)</span>
                      </label>
                      <input
                        value={form.addressLine2}
                        onChange={(e) => setForm({ ...form, addressLine2: e.target.value })}
                        placeholder="Street, area, landmark"
                        className={`${inputBase} ${inputOk}`}
                      />
                    </div>
                    <div>
                      <label className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-1.5">
                        Pincode
                      </label>
                      <input
                        value={form.postalCode}
                        inputMode="numeric"
                        maxLength={6}
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
                        placeholder="6-digit PIN"
                        aria-invalid={!!fieldErrors.postalCode}
                        className={`${inputBase} ${fieldErrors.postalCode ? inputErr : inputOk} tabular`}
                      />
                      {fieldErrors.postalCode ? (
                        <p className="mt-1 text-caption text-danger">{fieldErrors.postalCode}</p>
                      ) : pincodeLoading ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-caption text-ink-500">
                          <Loader2 className="size-3 animate-spin" /> Looking up pincode…
                        </p>
                      ) : pincodeError ? (
                        <p className="mt-1 text-caption text-danger">{pincodeError}</p>
                      ) : pincodeData ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-caption text-success">
                          <CheckCircle2 className="size-3" />
                          {pincodeData.district}, {pincodeData.state}
                        </p>
                      ) : null}
                    </div>
                    <div />
                    <div>
                      <label className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-1.5">
                        City / district
                      </label>
                      <input
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
                        readOnly={pincodeAutoFilled}
                        placeholder="City"
                        aria-invalid={!!fieldErrors.city}
                        className={`${inputBase} ${
                          fieldErrors.city ? inputErr : pincodeAutoFilled ? inputAuto : inputOk
                        }`}
                      />
                      {fieldErrors.city && (
                        <p className="mt-1 text-caption text-danger">{fieldErrors.city}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-1.5">
                        State
                      </label>
                      <input
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
                        readOnly={pincodeAutoFilled}
                        placeholder="State"
                        aria-invalid={!!fieldErrors.state}
                        className={`${inputBase} ${
                          fieldErrors.state ? inputErr : pincodeAutoFilled ? inputAuto : inputOk
                        }`}
                      />
                      {fieldErrors.state && (
                        <p className="mt-1 text-caption text-danger">{fieldErrors.state}</p>
                      )}
                    </div>
                    {pincodeData && pincodeData.places && pincodeData.places.length > 0 && (
                      <div className="col-span-2">
                        <label className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-1.5">
                          Locality
                        </label>
                        <select
                          value={selectedPlace}
                          onChange={(e) => {
                            setSelectedPlace(e.target.value);
                            setForm((prev) => ({ ...prev, locality: e.target.value }));
                          }}
                          className={`${inputBase} ${inputOk} cursor-pointer`}
                        >
                          <option value="">Select your locality</option>
                          {pincodeData.places.map((place, idx) => (
                            <option key={idx} value={place.name}>{place.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 flex items-center gap-3">
                    <button
                      onClick={handleCreateAddress}
                      className="inline-flex items-center h-11 px-5 bg-ink-900 text-white font-semibold hover:bg-ink-800 transition-colors rounded-full"
                    >
                      {editingAddressId ? 'Update address' : 'Save address'}
                    </button>
                    {(addresses.length > 0 || editingAddressId) && (
                      <button
                        onClick={() => { setShowNewAddress(false); resetAddressForm(); }}
                        className="inline-flex items-center h-11 px-5 border border-ink-300 hover:border-ink-900 text-body font-medium rounded-full"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Order items */}
            <section className="mt-10">
              <h2 className="font-display text-h3 text-ink-900 mb-4">Order items</h2>

              {checkoutData && !checkoutData.allServiceable && (
                <div className="mb-4 p-4 border border-warning/30 bg-amber-50 text-warning">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="size-4 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-body font-semibold">
                        {checkoutData.unserviceableCount} {itemNoun(checkoutData.unserviceableCount)} can&apos;t be delivered to this address
                      </p>
                      <p className="text-caption mt-1 text-amber-800">
                        Remove the marked items to continue checking out.
                      </p>
                      <button
                        onClick={handleRemoveUnserviceable}
                        disabled={removingUnserviceable}
                        className="mt-3 inline-flex items-center h-9 px-3.5 bg-warning text-white text-caption font-semibold hover:bg-amber-700 disabled:opacity-60 rounded-full"
                      >
                        {removingUnserviceable ? 'Removing…' : 'Remove unserviceable items'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <ul className="bg-white border border-ink-200 divide-y divide-ink-100 rounded-2xl overflow-hidden">
                {(checkoutData ? checkoutData.items : cart.items.map((c) => ({
                  cartItemId: c.id, productId: c.productId ?? '', variantId: null,
                  productTitle: c.productTitle, variantTitle: c.variantTitle,
                  imageUrl: c.imageUrl, sku: null, quantity: c.quantity,
                  unitPrice: c.unitPrice, lineTotal: c.lineTotal, serviceable: true,
                  allocatedSellerName: null, estimatedDeliveryDays: null,
                  reservationId: null,
                } as CheckoutItem))).map((item, idx) => (
                  <li
                    key={idx}
                    className={`flex gap-4 p-4 ${item.serviceable ? '' : 'opacity-60'}`}
                  >
                    <div className="size-16 bg-ink-100 grid place-items-center overflow-hidden shrink-0">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt="" loading="lazy" className="size-full object-contain p-1" />
                      ) : (
                        <ImageIcon className="size-5 text-ink-400" strokeWidth={1.5} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium text-ink-900 truncate">
                        {item.productTitle}
                      </div>
                      {item.variantTitle && (
                        <div className="text-caption text-ink-600 truncate">{item.variantTitle}</div>
                      )}
                      <div className="text-caption text-ink-500 mt-0.5">
                        Qty: {item.quantity}
                      </div>
                      {item.serviceable && item.estimatedDeliveryDays !== null && (
                        <div className="mt-1 inline-flex items-center gap-1 text-caption text-success">
                          <Truck className="size-3" />
                          Delivery in {item.estimatedDeliveryDays} day{item.estimatedDeliveryDays !== 1 ? 's' : ''}
                        </div>
                      )}
                      {!item.serviceable && (
                        <div className="mt-1 inline-flex items-center gap-1 text-caption text-danger font-medium">
                          <AlertCircle className="size-3" />
                          {item.unserviceableReason || 'Cannot be delivered to this address'}
                        </div>
                      )}
                    </div>
                    <div className="text-body font-semibold text-ink-900 tabular">
                      {item.serviceable
                        ? formatPrice(item.lineTotal)
                        : <span className="text-danger line-through">{formatPrice(item.lineTotal)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* ─── Right column ────────────────────────── */}
          <aside className="lg:sticky lg:top-24 bg-white border border-ink-200 p-5 rounded-2xl">
            <h3 className="font-display text-h3 text-ink-900 mb-4">Order summary</h3>

            {/* Payment method */}
            <div className="mb-5">
              <div className="text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                Payment
              </div>
              <div className="flex items-center gap-3 p-3 border-2 border-ink-900 bg-accent-soft/30">
                <div className="size-9 grid place-items-center bg-ink-900 text-white">
                  <Wallet className="size-4" strokeWidth={1.75} />
                </div>
                <div>
                  <div className="text-body font-semibold text-ink-900">Cash on Delivery</div>
                  <div className="text-caption text-ink-600">Pay when you receive</div>
                </div>
              </div>
            </div>

            {/* Coupon */}
            <div className="mb-5">
              <div className="text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2 flex items-center gap-1.5">
                <Tag className="size-3.5" />
                Have a coupon?
              </div>
              {appliedCoupon ? (
                <div className="flex items-start justify-between gap-2 p-3 bg-green-50 border border-green-200">
                  <div className="min-w-0">
                    <div className="text-body font-bold text-success">
                      {appliedCoupon.code} applied
                    </div>
                    <div className="text-caption text-success/80 mt-0.5">
                      You save {formatPrice(appliedCoupon.discountAmount)}
                      {appliedCoupon.valueType === 'PERCENTAGE' ? ` (${appliedCoupon.value}% off)` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveCoupon}
                    className="text-caption font-semibold text-success hover:text-ink-900 underline underline-offset-2"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      placeholder="Enter code"
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
                      aria-invalid={!!couponError}
                      className={`flex-1 h-10 px-3 border bg-white text-body uppercase tracking-wider focus:outline-none rounded-full ${
                        couponError ? inputErr : inputOk
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleApplyCoupon}
                      disabled={couponApplying || !couponInput.trim()}
                      className="h-10 px-4 bg-ink-900 text-white text-caption font-semibold hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-full"
                    >
                      {couponApplying ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                  {couponError && (
                    <p className="mt-1.5 text-caption text-danger">{couponError}</p>
                  )}
                </>
              )}
            </div>

            {/* Totals */}
            <div className="space-y-2 text-body pb-4 border-b border-ink-200">
              <div className="flex justify-between">
                <span className="text-ink-700">
                  Subtotal <span className="text-ink-500">({currentItemCount} {itemNoun(currentItemCount)})</span>
                </span>
                <span className="text-ink-900 tabular">{formatPrice(currentSubtotal)}</span>
              </div>
              {checkoutData && checkoutData.unserviceableCount > 0 && (
                <div className="flex justify-between text-danger">
                  <span>Unserviceable ({checkoutData.unserviceableCount})</span>
                  <span className="tabular">
                    -{formatPrice(checkoutData.totalAmount - checkoutData.serviceableAmount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-ink-700">Delivery</span>
                <span className="text-success font-semibold uppercase tracking-wider text-caption">
                  Free
                </span>
              </div>
              {appliedCoupon && appliedCoupon.discountAmount > 0 && (
                <div className="flex justify-between text-success">
                  <span>Coupon ({appliedCoupon.code})</span>
                  <span className="tabular">-{formatPrice(appliedCoupon.discountAmount)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-between items-baseline pt-4 mb-5">
              <span className="text-body font-semibold text-ink-900">Total</span>
              <span className="font-display text-h3 text-ink-900 tabular">
                {formatPrice(total)}
              </span>
            </div>

            {/* Reservation timer */}
            {checkoutData && (
              <p className="mb-3 text-caption text-ink-500 text-center">
                Stock reserved until {new Date(checkoutData.expiresAt).toLocaleTimeString()}
              </p>
            )}

            {/* CTA */}
            {checkoutData ? (
              <button
                onClick={handlePlaceOrder}
                disabled={placing || !checkoutData.allServiceable || checkoutData.items.length === 0}
                aria-busy={placing}
                className={`w-full h-12 inline-flex items-center justify-center gap-2 font-semibold text-body transition-colors ${
                  !checkoutData.allServiceable
                    ? 'bg-ink-300 text-ink-600 cursor-not-allowed'
                    : 'bg-ink-900 text-white hover:bg-ink-800 disabled:opacity-70'
                }`}
              >
                {placing && <Loader2 className="size-4 animate-spin" />}
                {placing
                  ? 'Placing order…'
                  : !checkoutData.allServiceable
                    ? 'Remove unserviceable items first'
                    : (
                      <>
                        Place order (COD)
                        <ArrowRight className="size-4" />
                      </>
                    )}
              </button>
            ) : (
              <button
                onClick={handleInitiateCheckout}
                disabled={initiating || !selectedAddressId}
                aria-busy={initiating}
                className="w-full h-12 inline-flex items-center justify-center gap-2 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-full"
              >
                {initiating && <Loader2 className="size-4 animate-spin" />}
                {initiating ? 'Checking availability…' : (
                  <>
                    Check delivery &amp; continue
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            )}

            {/* Trust strip */}
            <div className="mt-5 pt-4 border-t border-ink-200 grid grid-cols-3 gap-2">
              {[
                { icon: ShieldCheck, label: 'Secure checkout' },
                { icon: Truck,       label: 'Free shipping' },
                { icon: Wallet,      label: 'Pay on delivery' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center text-center gap-1">
                  <Icon className="size-4 text-accent-dark" strokeWidth={1.75} />
                  <span className="text-[11px] text-ink-600 leading-tight">{label}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </StorefrontShell>
  );
}
